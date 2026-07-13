import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

export const REMINDERS_QUEUE = 'reminders';

export interface StaleApplicationJob {
  applicationId: string;
  userEmail: string;
  role: string;
  daysStale: number;
}

/**
 * Worker for the reminders queue. Runs in-process here; the same class can be
 * deployed as a standalone worker without code changes — that is the point of
 * keeping the transport (Redis) outside the handler.
 */
@Processor(REMINDERS_QUEUE)
export class RemindersProcessor extends WorkerHost {
  private readonly logger = new Logger(RemindersProcessor.name);

  async process(job: Job<StaleApplicationJob>): Promise<{ sent: boolean }> {
    const { userEmail, role, daysStale } = job.data;

    // Stand-in for a real mail provider (SES/Postmark). Kept as a seam so the
    // queue mechanics can be demonstrated without an external dependency.
    this.logger.log(
      `Reminder -> ${userEmail}: "${role}" has been idle for ${daysStale} days`,
    );
    await new Promise((r) => setTimeout(r, 50));

    return { sent: true };
  }
}
