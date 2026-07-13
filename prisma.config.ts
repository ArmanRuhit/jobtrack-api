import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Not env() — that throws when unset, and `prisma generate` (which runs at
    // image-build time, with no database around) must not need a connection.
    // Migrations still fail loudly at runtime if this is missing.
    url: process.env.DATABASE_URL ?? '',
  },
});
