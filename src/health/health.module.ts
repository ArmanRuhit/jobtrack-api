import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { TerminusModule } from '@nestjs/terminus';
import { REMINDERS_QUEUE } from '../jobs/reminders.processor';
import { HealthController } from './health.controller';

@Module({
  // Registering the queue here injects the *same* connection the workers use,
  // so the probe fails when the real queue connection is broken.
  imports: [TerminusModule, BullModule.registerQueue({ name: REMINDERS_QUEUE })],
  controllers: [HealthController],
})
export class HealthModule {}
