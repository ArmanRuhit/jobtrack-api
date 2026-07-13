import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { CompaniesService } from '../companies/companies.service';
import type { AuthUser } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';
import { ApplicationsService } from './applications.service';

const user: AuthUser = {
  id: 'user-1',
  email: 'arman@example.com',
  role: 'USER',
};
const admin: AuthUser = { id: 'admin-1', email: 'a@b.c', role: 'ADMIN' };

const baseApp = {
  id: 'app-1',
  userId: 'user-1',
  companyId: 'co-1',
  role: 'Senior Backend Engineer',
  status: 'APPLIED',
};

describe('ApplicationsService', () => {
  let service: ApplicationsService;
  let prisma: {
    application: Record<string, jest.Mock>;
    $transaction: jest.Mock;
  };
  let companies: { findOne: jest.Mock };

  beforeEach(async () => {
    prisma = {
      application: {
        create: jest.fn(),
        findUnique: jest.fn(),
        update: jest.fn(),
        delete: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        groupBy: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    companies = { findOne: jest.fn().mockResolvedValue({ id: 'co-1' }) };

    const moduleRef = await Test.createTestingModule({
      providers: [
        ApplicationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CompaniesService, useValue: companies },
      ],
    }).compile();

    service = moduleRef.get(ApplicationsService);
  });

  describe('create', () => {
    it('verifies the company exists before writing', async () => {
      prisma.application.create.mockResolvedValue(baseApp);

      await service.create(user, { companyId: 'co-1', role: 'SBE' });

      expect(companies.findOne).toHaveBeenCalledWith('co-1');
    });

    it('rejects an inverted salary range', async () => {
      await expect(
        service.create(user, {
          companyId: 'co-1',
          role: 'SBE',
          salaryMin: 200,
          salaryMax: 100,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.application.create).not.toHaveBeenCalled();
    });
  });

  describe('updateStatus', () => {
    it('rejects an illegal transition (APPLIED -> OFFER)', async () => {
      prisma.application.findUnique.mockResolvedValue(baseApp);

      await expect(
        service.updateStatus(user, 'app-1', { status: 'OFFER' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('allows a legal transition and records an audit event', async () => {
      prisma.application.findUnique.mockResolvedValue(baseApp);
      const tx = {
        application: {
          update: jest.fn().mockResolvedValue({ ...baseApp, status: 'SCREEN' }),
        },
        applicationEvent: { create: jest.fn() },
      };
      prisma.$transaction.mockImplementation((cb: (t: unknown) => unknown) =>
        cb(tx),
      );

      const result = await service.updateStatus(user, 'app-1', {
        status: 'SCREEN',
      });

      expect(result.status).toBe('SCREEN');
      expect(tx.applicationEvent.create).toHaveBeenCalledWith({
        data: {
          applicationId: 'app-1',
          fromStatus: 'APPLIED',
          toStatus: 'SCREEN',
          note: undefined,
        },
      });
    });

    it('is a no-op when the status is unchanged', async () => {
      prisma.application.findUnique.mockResolvedValue(baseApp);

      const result = await service.updateStatus(user, 'app-1', {
        status: 'APPLIED',
      });

      expect(result.status).toBe('APPLIED');
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });
  });

  describe('ownership', () => {
    it('forbids reading another user’s application', async () => {
      prisma.application.findUnique.mockResolvedValue({
        ...baseApp,
        userId: 'someone-else',
      });

      await expect(service.findOne(user, 'app-1')).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('lets an admin read any application', async () => {
      prisma.application.findUnique.mockResolvedValue(baseApp);

      await expect(service.findOne(admin, 'app-1')).resolves.toMatchObject({
        id: 'app-1',
      });
    });

    it('scopes a normal user’s list query to their own rows', async () => {
      prisma.application.findMany.mockResolvedValue([]);
      prisma.application.count.mockResolvedValue(0);

      await service.findAll(user, { page: 1, limit: 20 });

      expect(prisma.application.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
    });

    it('does not scope an admin’s list query', async () => {
      prisma.application.findMany.mockResolvedValue([]);
      prisma.application.count.mockResolvedValue(0);

      await service.findAll(admin, { page: 1, limit: 20 });

      expect(prisma.application.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: {} }),
      );
    });
  });
});
