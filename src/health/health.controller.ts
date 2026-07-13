import { Controller, Get } from '@nestjs/common';
import {
  HealthCheck,
  HealthCheckService,
  HealthIndicatorResult,
  MemoryHealthIndicator,
} from '@nestjs/terminus';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators';
import { PrismaService } from '../prisma/prisma.service';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prisma: PrismaService,
  ) {}

  /** Liveness: is the process up at all. Cheap, no dependencies. */
  @Public()
  @Get('live')
  live(): { status: string } {
    return { status: 'ok' };
  }

  /** Readiness: can we actually serve traffic (DB reachable, memory sane). */
  @Public()
  @Get('ready')
  @HealthCheck()
  ready() {
    return this.health.check([
      () => this.checkDatabase(),
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
}
