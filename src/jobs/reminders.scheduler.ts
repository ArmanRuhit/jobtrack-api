import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Queue } from 'bullmq';
import { PrismaService } from '../prisma/prisma.service';
import { REMINDERS_QUEUE, StaleApplicationJob } from './reminders.processor';

const STALE_AFTER_DAYS = 14;

@Injectable()
export class RemindersScheduler {
  private readonly logger = new Logger(RemindersScheduler.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(REMINDERS_QUEUE)
    private readonly queue: Queue<StaleApplicationJob>,
  ) {}

  /**
   * The cron job only *enqueues*; the worker does the work. That split keeps the
   * scheduler fast and lets retries/backoff be handled by BullMQ.
   */
  @Cron(CronExpression.EVERY_DAY_AT_9AM, { name: 'stale-application-nudge' })
  async enqueueStaleReminders(): Promise<number> {
    const cutoff = new Date(
      Date.now() - STALE_AFTER_DAYS * 24 * 60 * 60 * 1000,
    );

    const stale = await this.prisma.application.findMany({
      where: {
        status: { in: ['APPLIED', 'SCREEN'] },
        updatedAt: { lt: cutoff },
      },
      include: { user: { select: { email: true } } },
    });

    for (const app of stale) {
      await this.queue.add(
        'stale-application',
        {
          applicationId: app.id,
          userEmail: app.user.email,
          role: app.role,
          daysStale: Math.floor(
            (Date.now() - app.updatedAt.getTime()) / 86_400_000,
          ),
        },
        {
          // Idempotency: one reminder per application per day, even if the
          // scheduler fires twice (redeploy, multiple replicas).
          jobId: `stale:${app.id}:${new Date().toISOString().slice(0, 10)}`,
          attempts: 3,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: 100,
          removeOnFail: 500,
        },
      );
    }

    this.logger.log(`Enqueued ${stale.length} stale-application reminder(s)`);
    return stale.length;
  }
}
