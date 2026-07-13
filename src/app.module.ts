import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { ServeStaticModule } from '@nestjs/serve-static';
import { join } from 'node:path';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import type { RedisOptions } from 'ioredis';
import { ApplicationsModule } from './applications/applications.module';
import { AuthModule } from './auth/auth.module';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { CompaniesModule } from './companies/companies.module';
import { validateEnv } from './config/env.validation';
import { HealthModule } from './health/health.module';
import { JobsModule } from './jobs/jobs.module';
import { PrismaModule } from './prisma/prisma.module';

const isIpLiteral = (host: string): boolean =>
  /^\d{1,3}(\.\d{1,3}){3}$/.test(host) || host.includes(':');

/**
 * BullMQ needs `maxRetriesPerRequest: null` — with a finite value ioredis aborts
 * commands during a reconnect, which surfaces as silently dropped jobs.
 */
function buildRedisConnection(config: ConfigService): RedisOptions {
  const base: RedisOptions = { maxRetriesPerRequest: null };
  const url = config.get<string>('REDIS_URL');

  if (url) {
    const parsed = new URL(url);
    return {
      ...base,
      host: parsed.hostname,
      port: Number(parsed.port || 6379),
      username: parsed.username || undefined,
      password: parsed.password || undefined,
      // rediss:// means TLS. Managed providers frequently present a self-signed
      // cert, so verification is configurable — supply the CA where you can, and
      // only disable verification on a trusted private network.
      ...(parsed.protocol === 'rediss:'
        ? {
            tls: {
              // SNI takes a hostname, never an IP literal.
              ...(isIpLiteral(parsed.hostname)
                ? {}
                : { servername: parsed.hostname }),
              ca: config.get<string>('REDIS_CA_CERT'),
              rejectUnauthorized: config.get<boolean>(
                'REDIS_TLS_REJECT_UNAUTHORIZED',
              ),
            },
          }
        : {}),
    };
  }

  return {
    ...base,
    host: config.getOrThrow<string>('REDIS_HOST'),
    port: config.getOrThrow<number>('REDIS_PORT'),
  };
}

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),

    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => [
        {
          ttl: config.getOrThrow<number>('THROTTLE_TTL'),
          limit: config.getOrThrow<number>('THROTTLE_LIMIT'),
        },
      ],
    }),

    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: buildRedisConnection(config),
      }),
    }),

    ScheduleModule.forRoot(),

    // The dashboard ships with the API: one container, one URL, no CORS.
    // `exclude` keeps the static handler off the API surface, so an unknown
    // /applications/* path still 404s as JSON instead of returning index.html.
    ServeStaticModule.forRoot({
      rootPath: join(__dirname, '..', 'public'),
      exclude: [
        '/auth/{*path}',
        '/companies/{*path}',
        '/applications/{*path}',
        '/health/{*path}',
      ],
    }),

    PrismaModule,
    AuthModule,
    CompaniesModule,
    ApplicationsModule,
    JobsModule,
    HealthModule,
  ],
  providers: [
    // Order matters: throttle first, then authenticate, then authorize.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },
  ],
})
export class AppModule {}
