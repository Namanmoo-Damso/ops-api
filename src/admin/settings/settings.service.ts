import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { SettingsResponse } from './dto';

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

  constructor(private readonly prisma: PrismaService) {}

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
}
