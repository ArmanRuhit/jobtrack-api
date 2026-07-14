# JobTrack

**A production-shaped job-application tracker — NestJS 11 API + React dashboard, deployed and running.**

### ▶ [jobtrack.apps.armanruhit.dev](https://jobtrack.apps.armanruhit.dev/)

```
email:    demo@jobtrack.dev
password: DemoPassw0rd!
```

The credentials are pre-filled on the login screen — click **Sign in**. You'll land on a
pipeline board seeded with a realistic job search: 6 companies, 6 applications spread
across every status, each carrying the audit trail of how it got there.

**Also worth a look:** [`/docs`](https://jobtrack.apps.armanruhit.dev/docs) — interactive
OpenAPI, every endpoint callable in the browser · [`/health/ready`](https://jobtrack.apps.armanruhit.dev/health/ready) —
live readiness probe (Postgres, Redis, heap)

---

## What to look at first

If you have two minutes, these are the parts that aren't in a CRUD tutorial:

**Open an application and try to advance it.** The board only offers *legal* moves —
`APPLIED → SCREEN → ONSITE → OFFER`, or `REJECTED` from anywhere. The UI mirrors the rules,
but the server is the authority: an illegal transition is rejected with a 400 regardless of
what the client sends, and the dashboard surfaces that error rather than hiding it.
→ [`applications.service.ts`](src/applications/applications.service.ts)

**Then look at the timeline in the drawer.** Every status change writes an
`ApplicationEvent` **in the same transaction** as the update. A status can never change
without a record of how it got there — not "we remember to log it", but structurally
impossible to skip.

**The health pill in the header** polls `/health/ready` every 30s. It shows `healthy` only
when Postgres *and* Redis both answer; a degraded dependency is visible in the UI rather
than discovered by a user hitting a 500.

## The stack, and why

| | |
|---|---|
| **API** | NestJS 11, TypeScript (strict) |
| **Data** | PostgreSQL (Neon) + Prisma 7 |
| **Queue** | Redis + BullMQ |
| **Frontend** | React 19 + Vite, served by the API itself |
| **Deploy** | Docker (multi-stage, non-root) on Coolify |
| **CI** | GitHub Actions: lint, typecheck, unit + e2e, Docker build |

## Features

| Area | What's implemented |
|---|---|
| **Auth** | JWT access + refresh tokens, refresh **rotation** with stolen-token reuse detection; tokens stored only as SHA-256 hashes; bcrypt (cost 12); login always compares a hash so response time doesn't reveal whether an email exists |
| **Authorization** | Global `JwtAuthGuard` (secure by default, opt out via `@Public()`), `RolesGuard` for RBAC, plus per-row ownership checks so users only ever see their own applications |
| **Domain** | Applications move through an explicit state machine; illegal transitions are rejected with 400 |
| **Audit trail** | Every status change writes an `ApplicationEvent` in the **same transaction** as the update |
| **Validation** | `class-validator` DTOs behind a global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`: unknown fields are rejected, not silently ignored. Pagination is capped, so no request can ask for the whole table |
| **Errors** | One `AllExceptionsFilter` maps everything — including Prisma codes (`P2002`→409, `P2025`→404, `P2003`→400) — into a consistent JSON envelope |
| **Background work** | BullMQ queue + a daily cron enqueuing "this application has gone stale" reminders, with idempotent job IDs, retries and exponential backoff |
| **Ops** | `/health/live` (liveness) and `/health/ready` (readiness: Postgres + Redis + heap, on a bounded deadline), rate limiting, Helmet, graceful shutdown |
| **Dashboard** | React 19 + Vite; pipeline board, stats, detail drawer with the event timeline; built into `public/` and served by the API — one container, one URL, no CORS |
| **Docs** | OpenAPI/Swagger at `/docs`, JSON at `/docs/json` |
| **Tests** | Unit tests with a mocked Prisma + e2e driving the full HTTP stack against a real Postgres |

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
web/                       React dashboard (Vite → public/, served by the API)
```

**Why the layering looks like this.** Nest's DI container makes provider visibility
*explicit*: a service is injectable only where its module `exports` it and the consumer
`imports` it. `ApplicationsModule` imports `CompaniesModule` to confirm a company exists
before an application takes a foreign key on it — no shared globals, no reaching into
another module's tables.

## Engineering decisions

- **State machine as data, not conditionals.** `TRANSITIONS` is a lookup table, so the
  legal-move rules are reviewable in one place and testable without going through HTTP.
- **Global auth guard.** New routes are protected unless someone explicitly writes
  `@Public()` — a forgotten annotation fails closed, not open.
- **The frontend ships with the API.** One image, one URL, no CORS to configure and no
  second deployment to keep in sync. The build emits external scripts only, because
  Helmet's CSP is `script-src 'self'` — an inlined bundle would be blocked at runtime.
- **The dashboard doesn't reimplement the domain.** It mirrors the transition table to
  decide which buttons to show, but the server stays the authority and its 400 is surfaced,
  not hidden. Two sources of truth would drift; one source plus a hint does not.
- **No frontend framework tax.** React, and nothing else: no router (there's one view), no
  state library, no data-fetching library. A `fetch` wrapper and `useState` cover it.
- **Reminders log instead of sending mail.** The queue, retry, backoff and idempotency
  mechanics are real; the mail provider is a seam left deliberately unimplemented.
- **Prisma 7 over TypeORM.** Generated, fully-typed query results and a real migration
  history. The cost is a heavier production image; TypeORM would ship smaller but with
  weaker type inference at the query boundary.

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
| GET | `/applications` | paginated (max 100); filter by `status`, `companyId` |
| GET | `/applications/stats` | pipeline counts grouped by status |
| PATCH | `/applications/:id/status` | state machine; 400 on an illegal transition |
| GET | `/health/live`, `/health/ready` | public probes |

## Running it locally

```bash
docker compose up -d          # Postgres :5433, Redis :6380
cp .env.example .env
npm ci
npx prisma migrate dev        # create the schema
npm run db:seed               # demo candidate + pipeline (credentials above)
npm run build                 # nest build && vite build
npm run start:dev             # http://localhost:3000
```

The dashboard is served from `/`, the API docs from `/docs`. For frontend work,
`npm run web:dev` starts Vite with hot reload and proxies the API to `:3000`.

An `ADMIN` user (who can read every user's applications and delete companies) is only
created when `SEED_ADMIN_PASSWORD` is set in the environment — never as a literal in this
repo.

### Tests

```bash
npm test          # unit — mocked Prisma
npm run test:e2e  # e2e — full HTTP stack, needs `docker compose up -d`
```

### Docker

```bash
docker build -t jobtrack-api .
docker run -p 3000:3000 --env-file .env jobtrack-api
```

The image is multi-stage: dependencies, then a build stage that generates the Prisma client
and compiles both the API and the React bundle, then a slim runtime that carries only
production dependencies and runs as a non-root user with a healthcheck.
