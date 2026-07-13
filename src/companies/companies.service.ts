import { Injectable, NotFoundException } from '@nestjs/common';
import type { Company } from '../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCompanyDto, UpdateCompanyDto } from './dto/company.dto';

@Injectable()
export class CompaniesService {
  constructor(private readonly prisma: PrismaService) {}

  create(dto: CreateCompanyDto): Promise<Company> {
    // A duplicate name raises Prisma P2002, which AllExceptionsFilter maps to 409.
    return this.prisma.company.create({ data: dto });
  }

  findAll(search?: string): Promise<Company[]> {
    return this.prisma.company.findMany({
      where: search
        ? { name: { contains: search, mode: 'insensitive' } }
        : undefined,
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string): Promise<Company> {
    const company = await this.prisma.company.findUnique({ where: { id } });
    if (!company) throw new NotFoundException(`Company ${id} not found`);
    return company;
  }

  async update(id: string, dto: UpdateCompanyDto): Promise<Company> {
    await this.findOne(id);
    return this.prisma.company.update({ where: { id }, data: dto });
  }

  async remove(id: string): Promise<void> {
    await this.findOne(id);
    await this.prisma.company.delete({ where: { id } });
  }
}
