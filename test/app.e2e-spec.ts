import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Server } from 'node:http';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface Tokens {
  accessToken: string;
  refreshToken: string;
}
interface CompanyBody {
  id: string;
  name: string;
}
interface ApplicationBody {
  id: string;
  status: string;
  events?: { fromStatus: string | null; toStatus: string }[];
}

/**
 * Exercises the real HTTP stack (guards, pipes, filters) against a real database —
 * the layers that unit tests with a mocked Prisma cannot cover.
 */
describe('JobTrack API (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let http: Server;

  const email = `e2e-${Date.now()}@example.com`;
  const password = 'S3curePassw0rd!';

  let accessToken: string;
  let refreshToken: string;
  let companyId: string;
  let applicationId: string;

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);
    http = app.getHttpServer() as Server;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { startsWith: 'e2e-' } } });
    await prisma.company.deleteMany({ where: { name: { startsWith: 'E2E' } } });
    await app.close();
  });

  it('rejects unauthenticated access', () => {
    return request(http).get('/applications').expect(401);
  });

  it('registers a user and returns a token pair', async () => {
    const res = await request(http)
      .post('/auth/register')
      .send({ email, name: 'E2E User', password })
      .expect(201);

    const body = res.body as Tokens;
    expect(body.accessToken).toBeDefined();
    expect(body.refreshToken).toBeDefined();

    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
  });

  it('rejects a weak password at the validation pipe', () => {
    return request(http)
      .post('/auth/register')
      .send({
        email: `e2e-weak-${Date.now()}@example.com`,
        name: 'Weak',
        password: '123',
      })
      .expect(400);
  });

  it('creates a company', async () => {
    const res = await request(http)
      .post('/companies')
      .set(auth(accessToken))
      .send({ name: `E2E Co ${Date.now()}`, website: 'https://example.com' })
      .expect(201);

    companyId = (res.body as CompanyBody).id;
    expect(companyId).toBeDefined();
  });

  it('rejects unknown properties on the DTO', () => {
    return request(http)
      .post('/companies')
      .set(auth(accessToken))
      .send({ name: 'E2E Bad', injected: 'nope' })
      .expect(400);
  });

  it('creates an application against a real company', async () => {
    const res = await request(http)
      .post('/applications')
      .set(auth(accessToken))
      .send({ companyId, role: 'Senior Backend Engineer' })
      .expect(201);

    const body = res.body as ApplicationBody;
    expect(body.status).toBe('APPLIED');
    applicationId = body.id;
  });

  it('404s when the referenced company does not exist', () => {
    return request(http)
      .post('/applications')
      .set(auth(accessToken))
      .send({
        companyId: '00000000-0000-4000-8000-000000000000',
        role: 'Ghost Role',
      })
      .expect(404);
  });

  it('rejects an illegal status transition', () => {
    return request(http)
      .patch(`/applications/${applicationId}/status`)
      .set(auth(accessToken))
      .send({ status: 'OFFER' })
      .expect(400);
  });

  it('advances through a legal transition and records an audit event', async () => {
    await request(http)
      .patch(`/applications/${applicationId}/status`)
      .set(auth(accessToken))
      .send({ status: 'SCREEN', note: 'recruiter call' })
      .expect(200);

    const res = await request(http)
      .get(`/applications/${applicationId}`)
      .set(auth(accessToken))
      .expect(200);

    const body = res.body as ApplicationBody;
    expect(body.status).toBe('SCREEN');
    expect(body.events).toHaveLength(1);
    expect(body.events?.[0]).toMatchObject({
      fromStatus: 'APPLIED',
      toStatus: 'SCREEN',
    });
  });

  it('forbids another user from reading the application', async () => {
    const other = await request(http)
      .post('/auth/register')
      .send({
        email: `e2e-other-${Date.now()}@example.com`,
        name: 'Other',
        password,
      })
      .expect(201);

    return request(http)
      .get(`/applications/${applicationId}`)
      .set(auth((other.body as Tokens).accessToken))
      .expect(403);
  });

  it('forbids a non-admin from deleting a company', () => {
    return request(http)
      .delete(`/companies/${companyId}`)
      .set(auth(accessToken))
      .expect(403);
  });

  it('rotates the refresh token and rejects reuse of the old one', async () => {
    await request(http)
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(200);

    // Rotation revoked it — a second use must fail.
    return request(http)
      .post('/auth/refresh')
      .send({ refreshToken })
      .expect(401);
  });

  it('reports readiness', () => {
    return request(http)
      .get('/health/ready')
      .expect(200)
      .expect((res) => {
        expect((res.body as { status: string }).status).toBe('ok');
      });
  });
});
