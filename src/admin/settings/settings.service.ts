import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { SettingsResponse } from './dto';
import { NotificationsService } from '../notifications';

const DEFAULT_SETTINGS: Omit<SettingsResponse, 'updatedAt'> = {
  preferredStartTime: '09:00',
  preferredEndTime: '18:00',
  maxRetries: 3,
  retryInterval: 30,
  riskSensitivity: 2,
  healthCheck: true,
  mealCheck: true,
  medicationCheck: true,
  sleepCheck: false,
  moodCheck: true,
};

@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notificationsService: NotificationsService,
  ) {}

  async getSettings(organizationId: string): Promise<SettingsResponse> {
    const settings = await this.prisma.organizationSettings.findUnique({
      where: { organizationId },
    });

    if (!settings) {
      // Return defaults if no settings exist yet
      return {
        ...DEFAULT_SETTINGS,
        updatedAt: new Date().toISOString(),
      };
    }

    return {
      preferredStartTime: settings.preferredStartTime,
      preferredEndTime: settings.preferredEndTime,
      maxRetries: settings.maxRetries,
      retryInterval: settings.retryInterval,
      riskSensitivity: settings.riskSensitivity,
      healthCheck: settings.healthCheck,
      mealCheck: settings.mealCheck,
      medicationCheck: settings.medicationCheck,
      sleepCheck: settings.sleepCheck,
      moodCheck: settings.moodCheck,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  async updateSettings(
    organizationId: string,
    data: Partial<Omit<SettingsResponse, 'updatedAt'>>,
  ): Promise<SettingsResponse> {
    // Upsert - create if doesn't exist, update if it does
    const settings = await this.prisma.organizationSettings.upsert({
      where: { organizationId },
      create: {
        organizationId,
        ...DEFAULT_SETTINGS,
        ...data,
      },
      update: data,
    });

    this.logger.log(`Settings updated for organization ${organizationId}`);

    // Create notification for settings change
    const changedFields = this.getChangedFieldLabels(data);
    if (changedFields.length > 0) {
      await this.notificationsService.createSettingsChangedNotification(
        organizationId,
        changedFields,
      );
    }

    return {
      preferredStartTime: settings.preferredStartTime,
      preferredEndTime: settings.preferredEndTime,
      maxRetries: settings.maxRetries,
      retryInterval: settings.retryInterval,
      riskSensitivity: settings.riskSensitivity,
      healthCheck: settings.healthCheck,
      mealCheck: settings.mealCheck,
      medicationCheck: settings.medicationCheck,
      sleepCheck: settings.sleepCheck,
      moodCheck: settings.moodCheck,
      updatedAt: settings.updatedAt.toISOString(),
    };
  }

  private getChangedFieldLabels(
    data: Partial<Omit<SettingsResponse, 'updatedAt'>>,
  ): string[] {
    const fieldLabels: Record<string, string> = {
      preferredStartTime: '통화 시작 시간',
      preferredEndTime: '통화 종료 시간',
      maxRetries: '최대 재시도 횟수',
      retryInterval: '재시도 간격',
      riskSensitivity: '위험 감지 민감도',
      healthCheck: '건강 확인',
      mealCheck: '식사 확인',
      medicationCheck: '복약 확인',
      sleepCheck: '수면 확인',
      moodCheck: '기분 확인',
    };

    return Object.keys(data)
      .filter((key) => data[key as keyof typeof data] !== undefined)
      .map((key) => fieldLabels[key] || key);
  }
}
