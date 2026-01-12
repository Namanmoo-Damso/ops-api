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
  }): Promise<GuardianRow> {
    const guardian = await this.prisma.guardian.create({
      data: {
        userId: params.userId,
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

  async findByWardEmail(wardEmail: string): Promise<
    | (GuardianRow & {
        registration_id: string;
        ward_email: string;
        ward_phone_number: string;
      })
    | undefined
  > {
    const normalizedEmail = wardEmail.toLowerCase().trim();
    // GuardianWardRegistration에서 wardEmail로 조회
    const registration = await this.prisma.guardianWardRegistration.findFirst({
      where: { wardEmail: { equals: normalizedEmail, mode: 'insensitive' } },
      include: { guardian: true },
    });
    if (!registration?.guardian) return undefined;
    return {
      ...toGuardianRow(registration.guardian),
      registration_id: registration.id,
      ward_email: registration.wardEmail,
      ward_phone_number: registration.wardPhoneNumber,
    };
  }

  async getWards(guardianId: string) {
    // 모든 어르신 등록 정보는 GuardianWardRegistration에서 관리
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
      orderBy: { createdAt: 'asc' },
    });

    // Collect all ward userIds for batch query
    const wardUserIds: string[] = [];
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

    // 첫 번째 등록을 primary로 표시
    for (let i = 0; i < registrations.length; i++) {
      const reg = registrations[i];
      const lastCallAt = reg.linkedWard?.userId
        ? (lastCallMap.get(reg.linkedWard.userId)?.toISOString() ?? null)
        : null;

      results.push({
        id: reg.id,
        ward_email: reg.wardEmail,
        ward_phone_number: reg.wardPhoneNumber,
        is_primary: i === 0, // 첫 번째 등록이 primary
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
    wardName?: string;
    relation?: string;
    birthDate?: string;
    gender?: string;
    address?: string;
    medicalConditions?: string;
    medications?: string;
  }): Promise<GuardianWardRegistrationRow> {
    const registration = await this.prisma.guardianWardRegistration.create({
      data: {
        guardianId: params.guardianId,
        wardEmail: params.wardEmail,
        wardPhoneNumber: params.wardPhoneNumber,
        wardName: params.wardName,
        relation: params.relation,
        birthDate: params.birthDate,
        gender: params.gender,
        address: params.address,
        medicalConditions: params.medicalConditions,
        medications: params.medications,
      },
    });
    return toGuardianWardRegistrationRow(registration);
  }

  async findFirstWardRegistration(
    guardianId: string,
  ): Promise<GuardianWardRegistrationRow | undefined> {
    const registration = await this.prisma.guardianWardRegistration.findFirst({
      where: { guardianId },
      orderBy: { createdAt: 'asc' },
    });
    return registration
      ? toGuardianWardRegistrationRow(registration)
      : undefined;
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

  // ===== Call Slot Config Methods =====

  async getSlotConfig() {
    const config = await this.prisma.callSlotConfig.findFirst({
      where: { id: 1 },
    });
    return config ?? {
      id: 1,
      slotDurationMinutes: 10,
      maxCallDurationMinutes: 8,
      maxCapacityPerSlot: 40,
      maxConcurrentCalls: 50,
      validMinutes: [0, 10, 20, 30, 40, 50],
    };
  }

  /**
   * 특정 슬롯(hour, minute, weekday)의 현재 예약 수 조회
   */
  async getSlotCapacity(
    hour: number,
    minute: number,
    weekday: number,
    excludeWardId?: string,
  ): Promise<number> {
    const count = await this.prisma.callScheduleGroup.count({
      where: {
        slotStartHour: hour,
        slotStartMinute: minute,
        weekdays: { has: weekday },
        isEnabled: true,
        wardId: { not: null },
        ...(excludeWardId ? { wardId: { not: excludeWardId } } : {}),
      },
    });
    return count;
  }

  /**
   * 슬롯 가용성 조회 (모든 요일)
   */
  async getSlotAvailability(hour: number, minute: number) {
    const config = await this.getSlotConfig();
    const maxCapacity = config.maxCapacityPerSlot;

    // 각 요일별 현재 예약 수 조회
    const counts = await Promise.all(
      [0, 1, 2, 3, 4, 5, 6].map(async weekday => {
        const current = await this.getSlotCapacity(hour, minute, weekday);
        return {
          weekday,
          current,
          available: Math.max(0, maxCapacity - current),
        };
      }),
    );

    return {
      slotStartHour: hour,
      slotStartMinute: minute,
      maxCapacity,
      availabilityByWeekday: Object.fromEntries(
        counts.map(c => [
          c.weekday,
          { current: c.current, available: c.available },
        ]),
      ),
    };
  }

  // ===== Call Schedule Group Methods =====

  async getCallScheduleGroups(guardianId: string) {
    // 1. Get linked ward
    const linkedWard = await this.prisma.ward.findFirst({
      where: { guardianId },
    });

    // 2. Get registrations
    const registrations = await this.prisma.guardianWardRegistration.findMany({
      where: { guardianId },
      select: { id: true },
    });
    const registrationIds = registrations.map(r => r.id);

    // 3. Get schedules for ward or registrations
    const schedules = await this.prisma.callScheduleGroup.findMany({
      where: {
        OR: [
          ...(linkedWard ? [{ wardId: linkedWard.id }] : []),
          ...(registrationIds.length > 0
            ? [{ registrationId: { in: registrationIds } }]
            : []),
        ],
      },
      orderBy: { createdAt: 'asc' },
    });

    return schedules.map(s => ({
      id: s.id,
      registration_id: s.registrationId,
      ward_id: s.wardId,
      slot_start_hour: s.slotStartHour,
      slot_start_minute: s.slotStartMinute,
      weekdays: s.weekdays,
      is_enabled: s.isEnabled,
      created_at: s.createdAt,
      updated_at: s.updatedAt,
    }));
  }

  async createCallScheduleGroups(
    registrationId: string | null,
    wardId: string | null,
    items: Array<{
      id?: string;
      slotStartHour: number;
      slotStartMinute: number;
      weekdays: number[];
      isEnabled: boolean;
    }>,
  ) {
    const data = items.map(item => ({
      registrationId,
      wardId,
      slotStartHour: item.slotStartHour,
      slotStartMinute: item.slotStartMinute,
      weekdays: item.weekdays,
      isEnabled: item.isEnabled,
    }));

    await this.prisma.callScheduleGroup.createMany({ data });
  }

  /**
   * 스케줄 생성 (SELECT FOR UPDATE 동시성 제어)
   * 트랜잭션 내에서 용량 검증 + 생성을 원자적으로 수행
   */
  async createCallScheduleGroupsWithLock(
    registrationId: string | null,
    wardId: string | null,
    items: Array<{
      slotStartHour: number;
      slotStartMinute: number;
      weekdays: number[];
      isEnabled: boolean;
    }>,
    maxCapacity: number,
  ): Promise<{
    success: boolean;
    error?: {
      code: string;
      message: string;
      details: {
        weekday: number;
        slotStartHour: number;
        slotStartMinute: number;
        currentCount: number;
        maxCapacity: number;
      };
    };
  }> {
    const weekdayNames = ['일', '월', '화', '수', '목', '금', '토'];

    return this.prisma.$transaction(async tx => {
      // 각 item별로 용량 검증 (SELECT FOR UPDATE)
      for (const item of items) {
        if (!item.isEnabled) continue;

        // 데드락 방지: 요일을 정렬하여 순서 고정
        const sortedWeekdays = [...item.weekdays].sort((a, b) => a - b);

        for (const weekday of sortedWeekdays) {
          // SELECT FOR UPDATE로 해당 슬롯 행들 잠금
          let result: [{ cnt: bigint }];

          if (wardId) {
            // 자기 자신(wardId) 제외하고 카운트
            result = await tx.$queryRaw<[{ cnt: bigint }]>`
              SELECT COUNT(*) as cnt
              FROM call_schedule_groups
              WHERE slot_start_hour = ${item.slotStartHour}
                AND slot_start_minute = ${item.slotStartMinute}
                AND ${weekday} = ANY(weekdays)
                AND is_enabled = TRUE
                AND ward_id IS NOT NULL
                AND ward_id != ${wardId}::uuid
              FOR UPDATE
            `;
          } else {
            // wardId 없으면 전체 카운트
            result = await tx.$queryRaw<[{ cnt: bigint }]>`
              SELECT COUNT(*) as cnt
              FROM call_schedule_groups
              WHERE slot_start_hour = ${item.slotStartHour}
                AND slot_start_minute = ${item.slotStartMinute}
                AND ${weekday} = ANY(weekdays)
                AND is_enabled = TRUE
                AND ward_id IS NOT NULL
              FOR UPDATE
            `;
          }

          const currentCount = Number(result[0].cnt);

          if (currentCount >= maxCapacity) {
            // 트랜잭션 롤백 (에러 반환)
            return {
              success: false,
              error: {
                code: 'SLOT_CAPACITY_EXCEEDED',
                message: `${weekdayNames[weekday]}요일 ${item.slotStartHour}:${String(item.slotStartMinute).padStart(2, '0')} 슬롯이 가득 찼습니다 (${currentCount}/${maxCapacity})`,
                details: {
                  weekday,
                  slotStartHour: item.slotStartHour,
                  slotStartMinute: item.slotStartMinute,
                  currentCount,
                  maxCapacity,
                },
              },
            };
          }
        }
      }

      // 모든 용량 검증 통과 → INSERT
      const data = items.map(item => ({
        registrationId,
        wardId,
        slotStartHour: item.slotStartHour,
        slotStartMinute: item.slotStartMinute,
        weekdays: item.weekdays,
        isEnabled: item.isEnabled,
      }));

      await tx.callScheduleGroup.createMany({ data });

      return { success: true };
    });
  }

  async deleteCallScheduleGroupsByGuardian(guardianId: string) {
    // 1. Get linked ward
    const linkedWard = await this.prisma.ward.findFirst({
      where: { guardianId },
    });

    // 2. Get registrations
    const registrations = await this.prisma.guardianWardRegistration.findMany({
      where: { guardianId },
      select: { id: true },
    });
    const registrationIds = registrations.map(r => r.id);

    // 3. Delete schedules
    await this.prisma.callScheduleGroup.deleteMany({
      where: {
        OR: [
          ...(linkedWard ? [{ wardId: linkedWard.id }] : []),
          ...(registrationIds.length > 0
            ? [{ registrationId: { in: registrationIds } }]
            : []),
        ],
      },
    });
  }

  async deleteCallScheduleGroup(
    scheduleId: string,
    guardianId: string,
  ): Promise<boolean> {
    // Verify ownership first
    const linkedWard = await this.prisma.ward.findFirst({
      where: { guardianId },
    });

    const registrations = await this.prisma.guardianWardRegistration.findMany({
      where: { guardianId },
      select: { id: true },
    });
    const registrationIds = registrations.map(r => r.id);

    const schedule = await this.prisma.callScheduleGroup.findFirst({
      where: {
        id: scheduleId,
        OR: [
          ...(linkedWard ? [{ wardId: linkedWard.id }] : []),
          ...(registrationIds.length > 0
            ? [{ registrationId: { in: registrationIds } }]
            : []),
        ],
      },
    });

    if (!schedule) return false;

    await this.prisma.callScheduleGroup.delete({
      where: { id: scheduleId },
    });

    return true;
  }

  // ===== Ward Linking Methods =====

  async findPendingRegistrations(
    guardianId: string,
  ): Promise<Array<{ id: string; ward_email: string }>> {
    const registrations = await this.prisma.guardianWardRegistration.findMany({
      where: {
        guardianId,
        linkedWardId: null,
      },
      select: {
        id: true,
        wardEmail: true,
      },
    });
    return registrations.map((r) => ({
      id: r.id,
      ward_email: r.wardEmail,
    }));
  }

  async updateRegistrationLinkedWard(
    registrationId: string,
    wardId: string,
  ): Promise<void> {
    await this.prisma.guardianWardRegistration.update({
      where: { id: registrationId },
      data: { linkedWardId: wardId },
    });
  }
}
