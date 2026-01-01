import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { DbService } from '../database';

@Injectable()
export class WardsService {
  private readonly logger = new Logger(WardsService.name);

  constructor(private readonly dbService: DbService) {}

  async verifyWardAccess(userId: string) {
    const user = await this.dbService.findUserById(userId);
    if (!user || user.user_type !== 'ward') {
      throw new HttpException('Ward access required', HttpStatus.FORBIDDEN);
    }

    const ward = await this.dbService.findWardByUserId(user.id);
    if (!ward) {
      throw new HttpException('Ward info not found', HttpStatus.NOT_FOUND);
    }

    return { user, ward };
  }

  async getSettings(userId: string) {
    const { user, ward } = await this.verifyWardAccess(userId);
    this.logger.log(`getSettings userId=${user.id} wardId=${ward.id}`);

    const notificationSettings = await this.dbService.getNotificationSettings(
      user.id,
    );

    return {
      aiPersona: ward.ai_persona,
      weeklyCallCount: ward.weekly_call_count,
      callDurationMinutes: ward.call_duration_minutes,
      notificationSettings: {
        callReminder: notificationSettings.call_reminder,
        callComplete: notificationSettings.call_complete,
        healthAlert: notificationSettings.health_alert,
      },
    };
  }

  async updateSettings(
    userId: string,
    settings: {
      aiPersona?: string;
      weeklyCallCount?: number;
      callDurationMinutes?: number;
    },
  ) {
    const { user, ward } = await this.verifyWardAccess(userId);

    if (
      settings.weeklyCallCount !== undefined &&
      (settings.weeklyCallCount < 1 || settings.weeklyCallCount > 7)
    ) {
      throw new HttpException(
        'weeklyCallCount must be between 1 and 7',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (
      settings.callDurationMinutes !== undefined &&
      (settings.callDurationMinutes < 5 || settings.callDurationMinutes > 60)
    ) {
      throw new HttpException(
        'callDurationMinutes must be between 5 and 60',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`updateSettings userId=${user.id} wardId=${ward.id}`);

    const updated = await this.dbService.updateWardSettings({
      wardId: user.id,
      aiPersona: settings.aiPersona?.trim(),
      weeklyCallCount: settings.weeklyCallCount,
      callDurationMinutes: settings.callDurationMinutes,
    });

    if (!updated) {
      throw new HttpException(
        'Failed to update settings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      aiPersona: updated.ai_persona,
      weeklyCallCount: updated.weekly_call_count,
      callDurationMinutes: updated.call_duration_minutes,
    };
  }

  async updateLocation(
    userId: string,
    location: {
      latitude: number;
      longitude: number;
      accuracy?: number;
      timestamp?: string;
    },
  ) {
    const { user, ward } = await this.verifyWardAccess(userId);

    this.logger.log(
      `updateLocation userId=${user.id} wardId=${ward.id} lat=${location.latitude} lng=${location.longitude}`,
    );

    // 현재 위치 업데이트 (upsert)
    await this.dbService.upsertWardCurrentLocation({
      wardId: ward.id,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? null,
    });

    // 위치 기록 저장
    await this.dbService.createWardLocation({
      wardId: ward.id,
      latitude: location.latitude,
      longitude: location.longitude,
      accuracy: location.accuracy ?? null,
      recordedAt: location.timestamp
        ? new Date(location.timestamp)
        : new Date(),
    });

    return {
      success: true,
      message: 'Location updated successfully',
    };
  }

  async triggerEmergency(
    userId: string,
    emergency: {
      type: string;
      message?: string;
      latitude?: number;
      longitude?: number;
      accuracy?: number;
    },
  ) {
    const { user, ward } = await this.verifyWardAccess(userId);

    this.logger.log(
      `triggerEmergency userId=${user.id} wardId=${ward.id} type=${emergency.type}`,
    );

    // 위치 정보가 있으면 현재 위치도 업데이트
    if (emergency.latitude !== undefined && emergency.longitude !== undefined) {
      await this.dbService.upsertWardCurrentLocation({
        wardId: ward.id,
        latitude: emergency.latitude,
        longitude: emergency.longitude,
        accuracy: emergency.accuracy ?? null,
      });
    }

    // 위치 상태를 emergency로 변경
    await this.dbService.updateWardLocationStatus(ward.id, 'emergency');

    // TODO: 연결된 보호자에게 푸시 알림 전송
    // const guardian = await this.dbService.findGuardianByWardId(ward.id);
    // if (guardian) {
    //   await this.pushService.sendEmergencyAlert(guardian.userId, ward, emergency);
    // }

    return {
      success: true,
      message: 'Emergency alert sent',
      type: emergency.type,
    };
  }
}
