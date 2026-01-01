import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '../database';
import { CallsService } from '../calls/calls.service';

@Injectable()
export class NotificationScheduler {
  private readonly logger = new Logger(NotificationScheduler.name);

  constructor(
    private readonly dbService: DbService,
    private readonly callsService: CallsService,
  ) {}

  // 매 30분마다 리마인더 체크 (예: 09:00, 09:30, 10:00, ...)
  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkCallReminders() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=일, 1=월, ..., 6=토
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 30분 후 예정된 통화 확인
    const targetTime = new Date(now.getTime() + 30 * 60 * 1000);
    const startTime = `${String(currentHour).padStart(2, '0')}:${String(currentMinute).padStart(2, '0')}:00`;
    const endTime = `${String(targetTime.getHours()).padStart(2, '0')}:${String(targetTime.getMinutes()).padStart(2, '0')}:00`;

    this.logger.log(
      `checkCallReminders dayOfWeek=${dayOfWeek} timeRange=${startTime}-${endTime}`,
    );

    try {
      const schedules = await this.dbService.getUpcomingCallSchedules(
        dayOfWeek,
        startTime,
        endTime,
      );

      for (const schedule of schedules) {
        // 어르신에게 리마인더 푸시
        await this.callsService.sendUserPush({
          identity: schedule.ward_identity,
          type: 'alert',
          title: '담소',
          body: `30분 후 ${schedule.ai_persona}와 대화 예정이에요`,
          payload: { type: 'call_reminder', scheduleId: schedule.id },
        });

        // 리마인더 전송 완료 기록
        await this.dbService.markReminderSent(schedule.id);

        this.logger.log(
          `checkCallReminders sent wardIdentity=${schedule.ward_identity} scheduleId=${schedule.id}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `checkCallReminders failed error=${(error as Error).message}`,
      );
    }
  }

  // 매 시간 미진행 통화 체크
  @Cron(CronExpression.EVERY_HOUR)
  async checkMissedCalls() {
    this.logger.log('checkMissedCalls started');

    try {
      const missedCalls = await this.dbService.getMissedCalls(1);

      for (const missed of missedCalls) {
        // 보호자에게 미진행 알림
        await this.callsService.sendUserPush({
          identity: missed.guardian_identity,
          type: 'alert',
          title: '담소',
          body: '어르신이 오늘 예정된 통화를 하지 않으셨어요',
          payload: { type: 'missed_call', wardId: missed.ward_id },
        });

        this.logger.log(
          `checkMissedCalls sent guardianIdentity=${missed.guardian_identity} wardId=${missed.ward_id}`,
        );
      }
    } catch (error) {
      this.logger.error(
        `checkMissedCalls failed error=${(error as Error).message}`,
      );
    }
  }

  // 통화 종료 시 보호자에게 알림 (CallsService에서 호출)
  async notifyCallComplete(callId: string) {
    try {
      const callInfo = await this.dbService.getCallWithWardInfo(callId);
      if (
        !callInfo ||
        !callInfo.guardian_identity ||
        !callInfo.guardian_user_id
      ) {
        this.logger.log(`notifyCallComplete no guardian callId=${callId}`);
        return;
      }

      // 보호자 알림 설정 확인
      const settings = await this.dbService.getGuardianNotificationSettings(
        callInfo.guardian_user_id,
      );
      if (!settings.call_complete) {
        this.logger.log(
          `notifyCallComplete disabled callId=${callId} guardianUserId=${callInfo.guardian_user_id}`,
        );
        return;
      }

      const aiPersona = callInfo.ward_ai_persona || '다미';
      await this.callsService.sendUserPush({
        identity: callInfo.guardian_identity,
        type: 'alert',
        title: '담소',
        body: `어르신과 ${aiPersona}의 대화가 끝났어요`,
        payload: { type: 'call_complete', callId },
      });

      this.logger.log(
        `notifyCallComplete sent callId=${callId} guardianIdentity=${callInfo.guardian_identity}`,
      );
    } catch (error) {
      this.logger.error(
        `notifyCallComplete failed callId=${callId} error=${(error as Error).message}`,
      );
    }
  }
}
