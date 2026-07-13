import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { REMINDERS_QUEUE, RemindersProcessor } from './reminders.processor';
import { RemindersScheduler } from './reminders.scheduler';

@Module({
  imports: [BullModule.registerQueue({ name: REMINDERS_QUEUE })],
  providers: [RemindersProcessor, RemindersScheduler],
  exports: [RemindersScheduler],
})
export class JobsModule {}
