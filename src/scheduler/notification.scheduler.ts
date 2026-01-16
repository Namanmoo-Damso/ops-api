import {
  Injectable,
  Logger,
  OnModuleInit,
  OnModuleDestroy,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { DbService } from '../database';
import { CallsService } from '../calls/calls.service';
import { createClient, type RedisClientType } from 'redis';

@Injectable()
export class NotificationScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationScheduler.name);

  // 중복 발신 방지: 최근 발신된 스케줄 ID (5분간 유지)
  private readonly recentlyCalledSchedules = new Map<string, number>();
  private readonly DUPLICATE_PREVENTION_MS = 5 * 60 * 1000; // 5분

  // Redis 분산 락
  private redisClient: RedisClientType | null = null;
  private readonly LOCK_TTL_SECONDS = 300; // 5분

  constructor(
    private readonly dbService: DbService,
    private readonly callsService: CallsService,
  ) {}

  async onModuleInit() {
    const redisUrl = process.env.REDIS_URL;
    if (redisUrl) {
      try {
        this.redisClient = createClient({ url: redisUrl });
        await this.redisClient.connect();
        this.logger.log('Redis connected for scheduler distributed lock');
      } catch (error) {
        this.logger.warn(
          `Redis connection failed for scheduler lock: ${(error as Error).message}`,
        );
        this.redisClient = null;
      }
    } else {
      this.logger.warn('REDIS_URL not set - scheduler lock disabled');
    }
  }

  async onModuleDestroy() {
    if (this.redisClient) {
      await this.redisClient.quit();
    }
  }

  /**
   * 분산 락 획득 시도
   * @returns true if lock acquired, false if already locked
   */
  private async tryAcquireLock(lockKey: string): Promise<boolean> {
    if (!this.redisClient) {
      return true; // Redis 없으면 락 없이 진행 (단일 인스턴스 가정)
    }

    try {
      const result = await this.redisClient.set(
        lockKey,
        process.pid.toString(),
        {
          NX: true, // Only set if not exists
          EX: this.LOCK_TTL_SECONDS,
        },
      );
      return result === 'OK';
    } catch (error) {
      this.logger.error(`Lock acquire failed: ${(error as Error).message}`);
      return true; // 에러 시 진행 (락 없이)
    }
  }

  // 매 30분마다 리마인더 체크 (예: 09:00, 09:30, 10:00, ...)
  @Cron(CronExpression.EVERY_30_MINUTES)
  async checkCallReminders() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=일, 1=월, ..., 6=토
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // 분산 락 획득 시도
    const lockKey = `scheduler:reminder:${currentHour}:${currentMinute < 30 ? '00' : '30'}`;
    const acquired = await this.tryAcquireLock(lockKey);
    if (!acquired) {
      this.logger.debug(`checkCallReminders skipped - lock exists: ${lockKey}`);
      return;
    }

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
    const now = new Date();
    const lockKey = `scheduler:missed:${now.getHours()}`;
    const acquired = await this.tryAcquireLock(lockKey);
    if (!acquired) {
      this.logger.debug(`checkMissedCalls skipped - lock exists: ${lockKey}`);
      return;
    }

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

  /**
   * 스케줄된 슬롯에 자동 전화 발신
   * 매 10분 0초에 실행 (0, 10, 20, 30, 40, 50분)
   */
  @Cron('0 */10 * * * *')
  async initiateScheduledCalls() {
    const now = new Date();
    const dayOfWeek = now.getDay(); // 0=일, 1=월, ..., 6=토
    const slotStartHour = now.getHours();
    const slotStartMinute = Math.floor(now.getMinutes() / 10) * 10; // 10분 단위로 정규화

    // 분산 락 획득 시도
    const lockKey = `scheduler:call:${slotStartHour}:${String(slotStartMinute).padStart(2, '0')}`;
    const acquired = await this.tryAcquireLock(lockKey);
    if (!acquired) {
      this.logger.debug(
        `initiateScheduledCalls skipped - lock exists: ${lockKey}`,
      );
      return;
    }

    // 오래된 캐시 정리
    this.cleanupRecentlyCalled();

    try {
      const schedules = await this.dbService.getSchedulesForCurrentSlot(
        dayOfWeek,
        slotStartHour,
        slotStartMinute,
      );

      if (schedules.length === 0) {
        return; // 조용히 종료
      }

      this.logger.log(
        `initiateScheduledCalls dayOfWeek=${dayOfWeek} slot=${slotStartHour}:${String(slotStartMinute).padStart(2, '0')} found=${schedules.length}`,
      );

      for (const schedule of schedules) {
        // 중복 발신 방지
        if (this.recentlyCalledSchedules.has(schedule.schedule_id)) {
          this.logger.log(
            `initiateScheduledCalls skip duplicate scheduleId=${schedule.schedule_id}`,
          );
          continue;
        }

        try {
          // 전화 발신
          const result = await this.callsService.inviteCall({
            callerIdentity: 'ai-scheduler',
            callerName: schedule.ai_persona,
            calleeIdentity: schedule.ward_identity,
          });

          // 중복 방지 캐시에 추가
          this.recentlyCalledSchedules.set(schedule.schedule_id, Date.now());

          this.logger.log(
            `initiateScheduledCalls success scheduleId=${schedule.schedule_id} wardIdentity=${schedule.ward_identity} callId=${result.callId} roomName=${result.roomName}`,
          );
        } catch (callError) {
          this.logger.error(
            `initiateScheduledCalls call failed scheduleId=${schedule.schedule_id} error=${(callError as Error).message}`,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        `initiateScheduledCalls failed error=${(error as Error).message}`,
      );
    }
  }

  /**
   * 오래된 중복 방지 캐시 정리
   */
  private cleanupRecentlyCalled() {
    const now = Date.now();
    for (const [scheduleId, timestamp] of this.recentlyCalledSchedules) {
      if (now - timestamp > this.DUPLICATE_PREVENTION_MS) {
        this.recentlyCalledSchedules.delete(scheduleId);
      }
    }
  }

  /**
   * Stale call 정리: 'answered' 상태에서 오래 지속된 통화를 'ended'로 변경
   * LiveKit webhook 누락 시 안전망 역할
   *
   * 매 5분마다 실행
   */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async cleanupStaleCalls() {
    const now = new Date();
    const lockKey = `scheduler:stale-cleanup:${now.getHours()}:${Math.floor(now.getMinutes() / 5) * 5}`;
    const acquired = await this.tryAcquireLock(lockKey);
    if (!acquired) {
      this.logger.debug(`cleanupStaleCalls skipped - lock exists: ${lockKey}`);
      return;
    }

    const STALE_THRESHOLD_MINUTES = 15; // Calls can only last 10 minutes, so 15 is generous

    try {
      const endedCount = await this.dbService.endStaleCalls(
        STALE_THRESHOLD_MINUTES,
      );

      if (endedCount > 0) {
        this.logger.log(
          `cleanupStaleCalls ended ${endedCount} stale call(s) older than ${STALE_THRESHOLD_MINUTES} minutes`,
        );
      }
    } catch (error) {
      this.logger.error(
        `cleanupStaleCalls failed error=${(error as Error).message}`,
      );
    }
  }
}
