import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';
import 'dotenv/config';
import { PrismaClient } from '../src/generated/prisma/client';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
});

async function main(): Promise<void> {
  const passwordHash = await bcrypt.hash('S3curePassw0rd!', 12);

  const admin = await prisma.user.upsert({
    where: { email: 'admin@jobtrack.dev' },
    update: {},
    create: {
      email: 'admin@jobtrack.dev',
      name: 'Admin',
      passwordHash,
      role: 'ADMIN',
    },
  });

  const demo = await prisma.user.upsert({
    where: { email: 'demo@jobtrack.dev' },
    update: {},
    create: {
      email: 'demo@jobtrack.dev',
      name: 'Demo User',
      passwordHash,
    },
  });

  const companies = await Promise.all(
    [
      { name: 'RemoteIntegrity', website: 'https://remoteintegrity.com', industry: 'Software' },
      { name: 'Stripe', website: 'https://stripe.com', industry: 'Fintech' },
      { name: 'Vercel', website: 'https://vercel.com', industry: 'Developer Tools' },
    ].map((data) =>
      prisma.company.upsert({
        where: { name: data.name },
        update: {},
        create: data,
      }),
    ),
  );

  const existing = await prisma.application.count({
    where: { userId: demo.id },
  });

  if (existing === 0) {
    await prisma.application.createMany({
      data: [
        {
          userId: demo.id,
          companyId: companies[0].id,
          role: 'Senior Backend Engineer',
          status: 'ONSITE',
          salaryMin: 90_000,
          salaryMax: 200_000,
          source: 'careers page',
        },
        {
          userId: demo.id,
          companyId: companies[1].id,
          role: 'Backend Engineer, Payments',
          status: 'SCREEN',
          source: 'referral',
        },
        {
          userId: demo.id,
          companyId: companies[2].id,
          role: 'Platform Engineer',
          status: 'REJECTED',
          source: 'linkedin',
        },
      ],
    });
  }

  console.log(
    `Seeded: admin=${admin.email}, demo=${demo.email}, ${companies.length} companies`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
