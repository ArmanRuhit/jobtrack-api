import { z } from 'zod';

/**
 * Fail fast: the process must not boot with a half-configured environment.
 * Equivalent in spirit to Spring Boot's @ConfigurationProperties + JSR-380 validation.
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),

  DATABASE_URL: z.string().url(),

  // Managed Redis (Coolify, Upstash, Railway…) hands you a single URL that already
  // carries credentials and the TLS scheme (rediss://). It wins when present; the
  // host/port pair below is the local docker-compose fallback.
  REDIS_URL: z
    .string()
    .refine((v) => /^rediss?:\/\//.test(v), {
      message: 'must start with redis:// or rediss://',
    })
    .optional(),
  // Managed Redis often terminates TLS with a self-signed cert (Coolify does).
  // Strict verification then fails with SELF_SIGNED_CERT_IN_CHAIN and ioredis
  // reconnect-loops forever. Prefer supplying the CA; fall back to disabling
  // verification only when the connection is on a private network.
  REDIS_CA_CERT: z.string().optional(),
  REDIS_TLS_REJECT_UNAUTHORIZED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),

  REDIS_HOST: z.string().min(1).default('localhost'),
  REDIS_PORT: z.coerce.number().int().positive().default(6379),

  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('7d'),

  THROTTLE_TTL: z.coerce.number().int().positive().default(60000),
  THROTTLE_LIMIT: z.coerce.number().int().positive().default(100),
});

export type Env = z.infer<typeof envSchema>;

export function validateEnv(raw: Record<string, unknown>): Env {
  const parsed = envSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
