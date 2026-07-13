import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ApplicationStatus, Role } from '../generated/prisma/enums';
import type { Application } from '../generated/prisma/client';
import { CompaniesService } from '../companies/companies.service';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateApplicationDto,
  QueryApplicationsDto,
  UpdateApplicationDto,
  UpdateStatusDto,
} from './dto/application.dto';

/**
 * Legal status transitions. Encoding this as data (rather than scattered ifs)
 * keeps the state machine reviewable and testable in one place.
 */
const TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  APPLIED: ['SCREEN', 'REJECTED'],
  SCREEN: ['ONSITE', 'REJECTED'],
  ONSITE: ['OFFER', 'REJECTED'],
  OFFER: ['REJECTED'],
  REJECTED: [],
};

export interface PaginatedApplications {
  data: Application[];
  meta: { total: number; page: number; limit: number; pages: number };
}

@Injectable()
export class ApplicationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly companies: CompaniesService,
  ) {}

  async create(
    user: AuthUser,
    dto: CreateApplicationDto,
  ): Promise<Application> {
    // Cross-module call: proves the company exists before we take a FK on it.
    await this.companies.findOne(dto.companyId);

    if (
      dto.salaryMin !== undefined &&
      dto.salaryMax !== undefined &&
      dto.salaryMin > dto.salaryMax
    ) {
      throw new BadRequestException('salaryMin cannot exceed salaryMax');
    }

    return this.prisma.application.create({
      data: { ...dto, userId: user.id },
    });
  }

  async findAll(
    user: AuthUser,
    query: QueryApplicationsDto,
  ): Promise<PaginatedApplications> {
    const where = {
      // Admins see everything; a normal user only ever sees their own rows.
      ...(user.role === Role.ADMIN ? {} : { userId: user.id }),
      ...(query.status ? { status: query.status } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.application.findMany({
        where,
        include: { company: { select: { id: true, name: true } } },
        orderBy: { appliedAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.application.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: query.page,
        limit: query.limit,
        pages: Math.ceil(total / query.limit),
      },
    };
  }

  async findOne(user: AuthUser, id: string): Promise<Application> {
    const app = await this.prisma.application.findUnique({
      where: { id },
      include: {
        company: true,
        events: { orderBy: { createdAt: 'desc' } },
      },
    });
    if (!app) throw new NotFoundException(`Application ${id} not found`);
    this.assertOwnership(user, app.userId);
    return app;
  }

  async update(
    user: AuthUser,
    id: string,
    dto: UpdateApplicationDto,
  ): Promise<Application> {
    await this.findOne(user, id);
    if (dto.companyId) await this.companies.findOne(dto.companyId);

    return this.prisma.application.update({ where: { id }, data: dto });
  }

  /**
   * Status change + audit event are written in one transaction: an application
   * can never end up in a new state with no record of how it got there.
   */
  async updateStatus(
    user: AuthUser,
    id: string,
    dto: UpdateStatusDto,
  ): Promise<Application> {
    const app = await this.findOne(user, id);

    if (app.status === dto.status) return app;

    if (!TRANSITIONS[app.status].includes(dto.status)) {
      throw new BadRequestException(
        `Cannot move application from ${app.status} to ${dto.status}`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.application.update({
        where: { id },
        data: { status: dto.status },
      });
      await tx.applicationEvent.create({
        data: {
          applicationId: id,
          fromStatus: app.status,
          toStatus: dto.status,
          note: dto.note,
        },
      });
      return updated;
    });
  }

  async remove(user: AuthUser, id: string): Promise<void> {
    await this.findOne(user, id);
    await this.prisma.application.delete({ where: { id } });
  }

  async stats(user: AuthUser): Promise<{
    byStatus: Record<string, number>;
    total: number;
    activePipeline: number;
  }> {
    const where = user.role === Role.ADMIN ? {} : { userId: user.id };

    const grouped = await this.prisma.application.groupBy({
      by: ['status'],
      where,
      _count: { _all: true },
    });

    const byStatus = Object.fromEntries(
      grouped.map((g) => [g.status, g._count._all]),
    );
    const total = grouped.reduce((sum, g) => sum + g._count._all, 0);
    const activePipeline = total - (byStatus.REJECTED ?? 0);

    return { byStatus, total, activePipeline };
  }

  private assertOwnership(user: AuthUser, ownerId: string): void {
    if (user.role !== Role.ADMIN && user.id !== ownerId) {
      throw new ForbiddenException('You do not own this application');
    }
  }
}
