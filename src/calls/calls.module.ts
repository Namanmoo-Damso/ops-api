import { Module } from '@nestjs/common';
import { CallsController } from './calls.controller';
import { CallsService } from './calls.service';
import { NotificationScheduler } from '../scheduler';

@Module({
  controllers: [CallsController],
  providers: [CallsService, NotificationScheduler],
  exports: [CallsService],
})
export class CallsModule {}
