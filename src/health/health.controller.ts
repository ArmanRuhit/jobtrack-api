import { InjectQueue } from '@nestjs/bullmq';
import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { Queue } from 'bullmq';
import type { Redis } from 'ioredis';
import { Public } from '../common/decorators';
import { REMINDERS_QUEUE } from '../jobs/reminders.processor';
import { PrismaService } from '../prisma/prisma.service';

const REDIS_PING_TIMEOUT_MS = 2_000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Redis did not respond within ${ms}ms`)),
        ms,
      );
    }),
  ]).finally(() => clearTimeout(timer));
}

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
    @InjectQueue(REMINDERS_QUEUE) private readonly queue: Queue,
  ) {}

  /** Liveness: is the process up at all. Cheap, no dependencies. */
  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: can we actually serve traffic (DB + queue reachable, memory sane). */
  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.checkDatabase(),
      () => this.checkRedis(),
      () => this.memory.checkHeap('memory_heap', 512 * 1024 * 1024),
    ]);
  }

  private async checkDatabase(): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { database: { status: 'up' } };
    } catch (err) {
      return {
        database: {
          status: 'down',
          message: err instanceof Error ? err.message : 'unknown error',
        },
      };
    }
  }

  /**
   * Pings the queue's own Redis connection, not a fresh client — a probe that
   * opens its own connection can pass while the connection BullMQ actually uses
   * is stuck reconnecting, which is precisely the failure this is here to catch.
   */
  private async checkRedis(): Promise<HealthIndicatorResult> {
    try {
      // Both halves must be inside the deadline: `queue.client` does not resolve
      // until BullMQ has connected, and a disconnected ioredis *queues* commands
      // rather than rejecting them — so either can hang, and an unbounded probe
      // hangs with it. A Redis that cannot answer in time is down, by definition.
      const pong = await withTimeout(
        (async () => {
          // BullMQ types this as IRedisClient, which doesn't surface ping().
          const client = (await this.queue.client) as unknown as Redis;
          return client.ping();
        })(),
        REDIS_PING_TIMEOUT_MS,
      );

      return {
        redis: { status: pong === 'PONG' ? 'up' : 'down', response: pong },
      };
    } catch (err) {
      return {
        redis: {
          status: 'down',
          message: err instanceof Error ? err.message : 'unknown error',
        },
      };
    }
  }
}
