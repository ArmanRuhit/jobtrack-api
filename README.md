# JobTrack API

A production-shaped REST API for tracking job applications through a hiring pipeline —
built with **NestJS 11**, **TypeScript (strict)**, **PostgreSQL + Prisma 7**, and **Redis/BullMQ**.

Not a CRUD demo: it has a real domain state machine, an audit trail, refresh-token
rotation with reuse detection, role- and ownership-based authorization, background jobs,
and a container that runs as a non-root user.

## Features

| Area | What's implemented |
|---|---|
| **Auth** | JWT access + refresh tokens, refresh **rotation** with stolen-token reuse detection; tokens stored only as SHA-256 hashes; bcrypt (cost 12); login always compares a hash so response time doesn't reveal whether an email exists |
| **Authorization** | Global `JwtAuthGuard` (secure by default, opt out via `@Public()`), `RolesGuard` for RBAC, plus per-row ownership checks so users only ever see their own applications |
| **Domain** | Applications move through an explicit state machine (`APPLIED → SCREEN → ONSITE → OFFER`, or `REJECTED`); illegal transitions are rejected with 400 |
| **Audit trail** | Every status change writes an `ApplicationEvent` in the **same transaction** as the update — a status can never change without a record of how it got there |
| **Validation** | `class-validator` DTOs behind a global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`: unknown fields are rejected, not silently ignored |
| **Errors** | One `AllExceptionsFilter` maps everything — including Prisma codes (`P2002`→409, `P2025`→404, `P2003`→400) — into a consistent JSON envelope |
| **Background work** | BullMQ queue + a daily cron that enqueues "this application has gone stale" reminders, with idempotent job IDs, retries and exponential backoff |
| **Ops** | `/health/live` (liveness) and `/health/ready` (readiness: DB + heap), rate limiting, Helmet, graceful shutdown hooks |
| **Docs** | OpenAPI/Swagger at `/docs`, JSON at `/docs/json` |
| **Tests** | Unit tests with a mocked Prisma (DI makes this trivial) + e2e tests driving the full HTTP stack against a real Postgres |
| **CI/CD** | GitHub Actions: lint, typecheck, unit tests, e2e (with Postgres + Redis service containers), Docker build |

## Architecture

```
src/
  main.ts                  bootstrap: pipes, helmet, swagger, shutdown hooks
  app.module.ts            composition root; global guards/filters/interceptors
  config/                  zod-validated env — the process refuses to boot misconfigured
  prisma/                  PrismaService (Prisma 7 + node-postgres driver adapter)
  common/
    guards/                JwtAuthGuard (global), RolesGuard
    filters/               AllExceptionsFilter (incl. Prisma error mapping)
    interceptors/          LoggingInterceptor (latency/status — AOP-style)
    decorators/            @Public, @Roles, @CurrentUser
  auth/                    register/login/refresh/logout, passport-jwt strategy
  companies/               company CRUD
  applications/            core domain: state machine, ownership, stats aggregation
  jobs/                    BullMQ processor + cron scheduler
  health/                  terminus liveness/readiness probes
```

**Why the layering looks like this.** Nest's DI container makes provider visibility
*explicit*: a service is injectable only where its module `exports` it and the consumer
`imports` it. `ApplicationsModule` imports `CompaniesModule` to confirm a company exists
before an application takes a foreign key on it — no shared globals, no reaching into
another module's tables.

## Running it

```bash
docker compose up -d          # Postgres :5433, Redis :6380
cp .env.example .env
npm ci
npx prisma migrate dev        # create the schema
npm run db:seed               # demo@jobtrack.dev / S3curePassw0rd!
npm run start:dev             # http://localhost:3000/docs
```

### Tests

```bash
npm test          # unit
npm run test:e2e  # e2e — requires `docker compose up -d`
```

### Docker

```bash
docker build -t jobtrack-api .
docker run -p 3000:3000 --env-file .env jobtrack-api
```

## API

| Method | Route | Notes |
|---|---|---|
| POST | `/auth/register` | public |
| POST | `/auth/login` | public |
| POST | `/auth/refresh` | public; rotates the token, reuse is rejected |
| POST | `/auth/logout` | revokes all refresh tokens |
| GET/POST | `/companies` | authenticated |
| PATCH/DELETE | `/companies/:id` | delete is **admin only** |
| POST | `/applications` | validates the company exists (404 if not) |
| GET | `/applications` | paginated; filter by `status`, `companyId` |
| GET | `/applications/stats` | pipeline counts grouped by status |
| PATCH | `/applications/:id/status` | state machine; 400 on an illegal transition |
| GET | `/health/live`, `/health/ready` | public probes |

## Notable tradeoffs

- **Prisma 7 over TypeORM.** Prisma gives generated, fully-typed query results and a real
  migration history. The cost: `@prisma/client` v7 pulls the Prisma CLI and TypeScript in
  as runtime dependencies, which inflates the production image (~750MB). TypeORM would ship
  a smaller image but with weaker type inference at the query boundary.
- **State machine as data, not conditionals.** `TRANSITIONS` is a lookup table, so the
  legal-move rules are reviewable in one place and testable without going through HTTP.
- **Global auth guard.** New routes are protected unless someone explicitly writes
  `@Public()` — a forgotten annotation fails closed, not open.
- **Reminders log instead of sending mail.** The queue, retry, backoff and idempotency
  mechanics are real; the mail provider is a seam left deliberately unimplemented.
