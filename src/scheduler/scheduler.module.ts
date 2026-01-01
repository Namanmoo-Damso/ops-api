import { Module } from '@nestjs/common';
import { NotificationScheduler } from './notification.scheduler';
import { CallsService } from '../calls/calls.service';

/**
 * 스케줄러 모듈
 *
 * Cron 기반 정기 작업을 처리합니다:
 * - 통화 리마인더 알림 (30분마다)
 * - 미진행 통화 체크 (매시간)
 */
@Module({
  providers: [NotificationScheduler, CallsService],
  exports: [NotificationScheduler],
})
export class SchedulerModule {}
