/**
 * Guardian Repository
 * guardians, guardian_ward_registrations, health_alerts, notification_settings 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { GuardianRow, GuardianWardRegistrationRow } from '../types';
import {
  toGuardianRow,
  toGuardianWardRegistrationRow,
} from '../prisma-mappers';

@Injectable()
export class GuardianRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    userId: string;
    wardEmail: string;
    wardPhoneNumber: string;
  }): Promise<GuardianRow> {
    const guardian = await this.prisma.guardian.create({
      data: {
        userId: params.userId,
        wardEmail: params.wardEmail,
        wardPhoneNumber: params.wardPhoneNumber,
      },
    });
    return toGuardianRow(guardian);
  }

  async findByUserId(userId: string): Promise<GuardianRow | undefined> {
    const guardian = await this.prisma.guardian.findUnique({
      where: { userId },
    });
    return guardian ? toGuardianRow(guardian) : undefined;
  }

  async findById(guardianId: string): Promise<
    | (GuardianRow & {
        user_nickname: string | null;
        user_profile_image_url: string | null;
      })
    | undefined
  > {
    const guardian = await this.prisma.guardian.findUnique({
      where: { id: guardianId },
      include: {
        user: {
          select: {
            nickname: true,
            profileImageUrl: true,
          },
        },
      },
    });
    if (!guardian) return undefined;
    return {
      ...toGuardianRow(guardian),
      user_nickname: guardian.user.nickname,
      user_profile_image_url: guardian.user.profileImageUrl,
    };
  }

  async findByWardEmail(wardEmail: string): Promise<GuardianRow | undefined> {
    const normalizedEmail = wardEmail.toLowerCase().trim();
    const guardian = await this.prisma.guardian.findFirst({
      where: { wardEmail: { equals: normalizedEmail, mode: 'insensitive' } },
    });
    return guardian ? toGuardianRow(guardian) : undefined;
  }

  async getWards(guardianId: string) {
    // Primary ward from guardians table
    const guardian = await this.prisma.guardian.findUnique({
      where: { id: guardianId },
      include: {
        wards: {
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                profileImageUrl: true,
              },
            },
          },
        },
      },
    });

    // Additional registrations
    const registrations = await this.prisma.guardianWardRegistration.findMany({
      where: { guardianId },
      include: {
        linkedWard: {
          include: {
            user: {
              select: {
                id: true,
                nickname: true,
                profileImageUrl: true,
              },
            },
          },
        },
      },
    });

    // Collect all ward userIds for batch query
    const wardUserIds: string[] = [];
    if (guardian?.wards[0]?.userId) {
      wardUserIds.push(guardian.wards[0].userId);
    }
    for (const reg of registrations) {
      if (reg.linkedWard?.userId) {
        wardUserIds.push(reg.linkedWard.userId);
      }
    }

    // Batch query: get last call for all wards at once
    const lastCalls =
      wardUserIds.length > 0
        ? await this.prisma.call.groupBy({
            by: ['calleeUserId'],
            where: { calleeUserId: { in: wardUserIds } },
            _max: { createdAt: true },
          })
        : [];
    const lastCallMap = new Map(
      lastCalls.map(c => [c.calleeUserId, c._max.createdAt]),
    );

    const results: Array<{
      id: string;
      ward_email: string;
      ward_phone_number: string;
      is_primary: boolean;
      linked_ward_id: string | null;
      ward_user_id: string | null;
      ward_nickname: string | null;
      ward_profile_image_url: string | null;
      last_call_at: string | null;
    }> = [];

    // Add primary ward
    if (guardian) {
      const primaryWard = guardian.wards[0];
      const lastCallAt = primaryWard?.userId
        ? (lastCallMap.get(primaryWard.userId)?.toISOString() ?? null)
        : null;

      results.push({
        id: guardian.id,
        ward_email: guardian.wardEmail,
        ward_phone_number: guardian.wardPhoneNumber,
        is_primary: true,
        linked_ward_id: primaryWard?.id ?? null,
        ward_user_id: primaryWard?.userId ?? null,
        ward_nickname: primaryWard?.user.nickname ?? null,
        ward_profile_image_url: primaryWard?.user.profileImageUrl ?? null,
        last_call_at: lastCallAt,
      });
    }

    // Add additional registrations
    for (const reg of registrations) {
      const lastCallAt = reg.linkedWard?.userId
        ? (lastCallMap.get(reg.linkedWard.userId)?.toISOString() ?? null)
        : null;

      results.push({
        id: reg.id,
        ward_email: reg.wardEmail,
        ward_phone_number: reg.wardPhoneNumber,
        is_primary: false,
        linked_ward_id: reg.linkedWardId,
        ward_user_id: reg.linkedWard?.userId ?? null,
        ward_nickname: reg.linkedWard?.user.nickname ?? null,
        ward_profile_image_url: reg.linkedWard?.user.profileImageUrl ?? null,
        last_call_at: lastCallAt,
      });
    }

    return results;
  }

  async createWardRegistration(params: {
    guardianId: string;
    wardEmail: string;
    wardPhoneNumber: string;
  }): Promise<GuardianWardRegistrationRow> {
    const registration = await this.prisma.guardianWardRegistration.create({
      data: {
        guardianId: params.guardianId,
        wardEmail: params.wardEmail,
        wardPhoneNumber: params.wardPhoneNumber,
      },
    });
    return toGuardianWardRegistrationRow(registration);
  }

  async findWardRegistration(
    id: string,
    guardianId: string,
  ): Promise<GuardianWardRegistrationRow | undefined> {
    const registration = await this.prisma.guardianWardRegistration.findFirst({
      where: { id, guardianId },
    });
    return registration
      ? toGuardianWardRegistrationRow(registration)
      : undefined;
  }

  async updateWardRegistration(params: {
    id: string;
    guardianId: string;
    wardEmail: string;
    wardPhoneNumber: string;
  }): Promise<GuardianWardRegistrationRow | undefined> {
    try {
      const registration = await this.prisma.guardianWardRegistration.update({
        where: { id: params.id },
        data: {
          wardEmail: params.wardEmail,
          wardPhoneNumber: params.wardPhoneNumber,
        },
      });
      // Verify guardianId matches
      if (registration.guardianId !== params.guardianId) {
        return undefined;
      }
      return toGuardianWardRegistrationRow(registration);
    } catch {
      return undefined;
    }
  }

  async deleteWardRegistration(
    id: string,
    guardianId: string,
  ): Promise<boolean> {
    return this.prisma.$transaction(async tx => {
      // First find the registration
      const registration = await tx.guardianWardRegistration.findFirst({
        where: { id, guardianId },
      });

      if (!registration) return false;

      // Unlink the ward if linked
      if (registration.linkedWardId) {
        await tx.ward.update({
          where: { id: registration.linkedWardId },
          data: { guardianId: null },
        });
      }

      // Delete the registration
      const result = await tx.guardianWardRegistration.deleteMany({
        where: { id, guardianId },
      });
      return result.count > 0;
    });
  }

  async updatePrimaryWard(params: {
    guardianId: string;
    wardEmail: string;
    wardPhoneNumber: string;
  }): Promise<GuardianRow | undefined> {
    try {
      const guardian = await this.prisma.guardian.update({
        where: { id: params.guardianId },
        data: {
          wardEmail: params.wardEmail,
          wardPhoneNumber: params.wardPhoneNumber,
        },
      });
      return toGuardianRow(guardian);
    } catch {
      return undefined;
    }
  }

  async unlinkPrimaryWard(guardianId: string): Promise<void> {
    await this.prisma.ward.updateMany({
      where: { guardianId },
      data: { guardianId: null },
    });
  }

  async getHealthAlerts(guardianId: string, limit: number = 5) {
    const alerts = await this.prisma.healthAlert.findMany({
      where: { guardianId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return alerts.map(alert => ({
      id: alert.id,
      type: alert.alertType,
      message: alert.message,
      date: alert.createdAt.toISOString().split('T')[0],
      isRead: alert.isRead,
    }));
  }

  async createHealthAlert(params: {
    wardId: string;
    guardianId: string;
    alertType: 'warning' | 'info';
    message: string;
  }): Promise<{ id: string }> {
    const alert = await this.prisma.healthAlert.create({
      data: {
        wardId: params.wardId,
        guardianId: params.guardianId,
        alertType: params.alertType,
        message: params.message,
      },
    });
    return { id: alert.id };
  }

  async getNotificationSettings(userId: string) {
    const settings = await this.prisma.notificationSettings.findUnique({
      where: { userId },
    });
    if (settings) {
      return {
        call_reminder: settings.callReminder,
        call_complete: settings.callComplete,
        health_alert: settings.healthAlert,
      };
    }
    return {
      call_reminder: true,
      call_complete: true,
      health_alert: true,
    };
  }

  async getGuardianNotificationSettings(guardianUserId: string) {
    const settings = await this.prisma.notificationSettings.findUnique({
      where: { userId: guardianUserId },
    });
    if (settings) {
      return {
        call_complete: settings.callComplete,
        health_alert: settings.healthAlert,
      };
    }
    return { call_complete: true, health_alert: true };
  }

  async upsertNotificationSettings(params: {
    userId: string;
    callReminder?: boolean;
    callComplete?: boolean;
    healthAlert?: boolean;
  }) {
    const settings = await this.prisma.notificationSettings.upsert({
      where: { userId: params.userId },
      update: {
        callReminder: params.callReminder,
        callComplete: params.callComplete,
        healthAlert: params.healthAlert,
      },
      create: {
        userId: params.userId,
        callReminder: params.callReminder ?? true,
        callComplete: params.callComplete ?? true,
        healthAlert: params.healthAlert ?? true,
      },
    });
    return {
      call_reminder: settings.callReminder,
      call_complete: settings.callComplete,
      health_alert: settings.healthAlert,
    };
  }
}
