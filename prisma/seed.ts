import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';
import type { ApplicationStatus } from '../src/generated/prisma/enums';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

// The demo login is public on purpose — it's read-mostly and scoped to its own rows.
const DEMO_PASSWORD = 'DemoPassw0rd!';

// The admin can read every user's applications and delete companies, so its password
// must never be a literal in a public repo. Set SEED_ADMIN_PASSWORD in the deployed
// environment; without it we skip creating the admin entirely.
const ADMIN_PASSWORD = process.env.SEED_ADMIN_PASSWORD;

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

/**
 * The path an application took to reach its current status. Seeding the events
 * (not just the final status) means GET /applications/:id shows a real audit
 * trail — which is the part worth looking at.
 */
interface Seed {
  company: string;
  role: string;
  status: ApplicationStatus;
  appliedAt: Date;
  salaryMin?: number;
  salaryMax?: number;
  source: string;
  notes?: string;
  history: {
    from: ApplicationStatus | null;
    to: ApplicationStatus;
    note: string;
    at: Date;
  }[];
}

const COMPANIES = [
  {
    name: 'RemoteIntegrity',
    website: 'https://remoteintegrity.com',
    industry: 'Software',
  },
  { name: 'Stripe', website: 'https://stripe.com', industry: 'Fintech' },
  {
    name: 'Vercel',
    website: 'https://vercel.com',
    industry: 'Developer Tools',
  },
  {
    name: 'Datadog',
    website: 'https://datadoghq.com',
    industry: 'Observability',
  },
  { name: 'Shopify', website: 'https://shopify.com', industry: 'E-commerce' },
  {
    name: 'Cloudflare',
    website: 'https://cloudflare.com',
    industry: 'Infrastructure',
  },
];

const APPLICATIONS: Seed[] = [
  {
    company: 'RemoteIntegrity',
    role: 'Senior Backend Engineer (Java with NestJS Exposure)',
    status: 'ONSITE',
    appliedAt: daysAgo(21),
    salaryMin: 90_000,
    salaryMax: 200_000,
    source: 'careers page',
    notes: 'Java-to-NestJS migration work. Strong overlap with European hours.',
    history: [
      {
        from: 'APPLIED',
        to: 'SCREEN',
        note: 'Recruiter call — 30 min, English fluency check',
        at: daysAgo(14),
      },
      {
        from: 'SCREEN',
        to: 'ONSITE',
        note: 'Technical panel scheduled: system design + NestJS deep dive',
        at: daysAgo(4),
      },
    ],
  },
  {
    company: 'Stripe',
    role: 'Backend Engineer, Payments',
    status: 'OFFER',
    appliedAt: daysAgo(45),
    salaryMin: 140_000,
    salaryMax: 210_000,
    source: 'referral',
    notes: 'Referred by a former colleague on the Ledger team.',
    history: [
      {
        from: 'APPLIED',
        to: 'SCREEN',
        note: 'Recruiter screen',
        at: daysAgo(38),
      },
      {
        from: 'SCREEN',
        to: 'ONSITE',
        note: 'Virtual onsite: 2x coding, 1x design, 1x behavioural',
        at: daysAgo(20),
      },
      {
        from: 'ONSITE',
        to: 'OFFER',
        note: 'Offer extended — negotiating start date',
        at: daysAgo(6),
      },
    ],
  },
  {
    company: 'Datadog',
    role: 'Senior Software Engineer, Ingestion',
    status: 'SCREEN',
    appliedAt: daysAgo(11),
    salaryMin: 120_000,
    salaryMax: 180_000,
    source: 'linkedin',
    history: [
      {
        from: 'APPLIED',
        to: 'SCREEN',
        note: 'Take-home: high-throughput log parser',
        at: daysAgo(3),
      },
    ],
  },
  {
    company: 'Cloudflare',
    role: 'Systems Engineer, Edge',
    status: 'APPLIED',
    appliedAt: daysAgo(2),
    source: 'careers page',
    notes: 'Rust-heavy; brushing up before any screen.',
    history: [],
  },
  {
    company: 'Shopify',
    role: 'Senior Backend Developer',
    status: 'APPLIED',
    // Deliberately stale (>14 days, still APPLIED) so the daily cron has
    // something to enqueue a reminder for.
    appliedAt: daysAgo(28),
    source: 'linkedin',
    notes: 'No response in 4 weeks — reminder job should flag this.',
    history: [],
  },
  {
    company: 'Vercel',
    role: 'Platform Engineer',
    status: 'REJECTED',
    appliedAt: daysAgo(60),
    source: 'linkedin',
    history: [
      {
        from: 'APPLIED',
        to: 'SCREEN',
        note: 'Recruiter screen',
        at: daysAgo(52),
      },
      {
        from: 'SCREEN',
        to: 'REJECTED',
        note: 'Went with a candidate in-timezone',
        at: daysAgo(44),
      },
    ],
  },
];

async function main(): Promise<void> {
  const demoHash = await bcrypt.hash(DEMO_PASSWORD, 12);

  if (ADMIN_PASSWORD) {
    const adminHash = await bcrypt.hash(ADMIN_PASSWORD, 12);
    await prisma.user.upsert({
      where: { email: 'admin@jobtrack.dev' },
      update: { passwordHash: adminHash },
      create: {
        email: 'admin@jobtrack.dev',
        name: 'Admin',
        passwordHash: adminHash,
        role: 'ADMIN',
      },
    });
  }

  const demo = await prisma.user.upsert({
    where: { email: 'demo@jobtrack.dev' },
    update: { passwordHash: demoHash },
    create: {
      email: 'demo@jobtrack.dev',
      name: 'Demo Candidate',
      passwordHash: demoHash,
    },
  });

  const companies = new Map<string, string>();
  for (const data of COMPANIES) {
    const c = await prisma.company.upsert({
      where: { name: data.name },
      update: {},
      create: data,
    });
    companies.set(c.name, c.id);
  }

  // Idempotent: wipe this demo user's applications so re-running the seed
  // doesn't stack duplicates (events cascade on delete).
  await prisma.application.deleteMany({ where: { userId: demo.id } });

  for (const seed of APPLICATIONS) {
    const companyId = companies.get(seed.company)!;

    const app = await prisma.application.create({
      data: {
        userId: demo.id,
        companyId,
        role: seed.role,
        status: seed.status,
        salaryMin: seed.salaryMin,
        salaryMax: seed.salaryMax,
        source: seed.source,
        notes: seed.notes,
        appliedAt: seed.appliedAt,
      },
    });

    for (const h of seed.history) {
      await prisma.applicationEvent.create({
        data: {
          applicationId: app.id,
          fromStatus: h.from,
          toStatus: h.to,
          note: h.note,
          createdAt: h.at,
        },
      });
    }

    // createdAt on the application is set by @default(now()); force updatedAt to
    // the last real activity so the stale-reminder cron sees truthful timestamps.
    const lastActivity = seed.history.at(-1)?.at ?? seed.appliedAt;
    await prisma.$executeRaw`UPDATE applications SET "updatedAt" = ${lastActivity} WHERE id = ${app.id}`;
  }

  const counts = await prisma.application.groupBy({
    by: ['status'],
    where: { userId: demo.id },
    _count: { _all: true },
  });

  console.log('Seed complete.');
  console.log(
    ADMIN_PASSWORD
      ? '  admin : admin@jobtrack.dev (password from SEED_ADMIN_PASSWORD)'
      : '  admin : skipped (set SEED_ADMIN_PASSWORD to create one)',
  );
  console.log(`  demo  : ${demo.email} / ${DEMO_PASSWORD}`);
  console.log(`  companies    : ${companies.size}`);
  console.log(`  applications : ${APPLICATIONS.length}`);
  for (const c of counts)
    console.log(`    ${c.status.padEnd(9)} ${c._count._all}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
