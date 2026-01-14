import { Injectable, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { DbService } from '../database';

@Injectable()
export class GuardiansService {
  private readonly logger = new Logger(GuardiansService.name);

  constructor(private readonly dbService: DbService) {}

  async verifyGuardianAccess(userId: string) {
    const user = await this.dbService.findUserById(userId);
    if (!user || user.user_type !== 'guardian') {
      throw new HttpException('Guardian access required', HttpStatus.FORBIDDEN);
    }

    const guardian = await this.dbService.findGuardianByUserId(user.id);
    if (!guardian) {
      throw new HttpException('Guardian info not found', HttpStatus.NOT_FOUND);
    }

    return { user, guardian };
  }

  async getDashboard(userId: string, period?: 'today' | 'week' | 'month', wardId?: string) {
    const { guardian } = await this.verifyGuardianAccess(userId);

    // wardId가 제공되면 해당 어르신 사용, 아니면 첫 번째 연동된 어르신
    let targetWard: { id: string; user_nickname?: string | null } | null = null;
    if (wardId) {
      const ward = await this.dbService.findWardById(wardId);
      if (ward && ward.guardian_id === guardian.id) {
        targetWard = ward;
      } else {
        throw new HttpException(
          {
            success: false,
            error: {
              code: 'WARD_NOT_FOUND',
              message: '어르신을 찾을 수 없습니다.',
            },
          },
          HttpStatus.NOT_FOUND,
        );
      }
    } else {
      targetWard = (await this.dbService.findWardByGuardianId(guardian.id)) ?? null;
    }

    if (!targetWard) {
      return {
        wardId: null,
        wardName: null,
        statistics: {
          totalCalls: 0,
          weeklyChange: 0,
          averageDuration: 0,
          overallMood: { positive: 0, negative: 0 },
        },
        aiSummary: '',
        alerts: [],
        recentCalls: [],
      };
    }

    this.logger.log(
      `getDashboard guardianId=${guardian.id} wardId=${targetWard.id} period=${period ?? 'default'}`,
    );

    // 기간에 따른 일수 계산
    const days = period === 'today' ? 1 : period === 'month' ? 30 : 7;

    const [stats, weeklyChange, moodStats, alerts, recentCalls] =
      await Promise.all([
        this.dbService.getWardCallStats(targetWard.id, days),
        this.dbService.getWardWeeklyCallChange(targetWard.id),
        this.dbService.getWardMoodStats(targetWard.id, days),
        this.dbService.getHealthAlerts(guardian.id, 5),
        this.dbService.getRecentCallSummaries(targetWard.id, 5),
      ]);

    // aiSummary 생성 (최근 통화 기반)
    const aiSummary = this.generateAiSummary(recentCalls, targetWard.user_nickname);

    return {
      wardId: targetWard.id,
      wardName: targetWard.user_nickname ?? null,
      statistics: {
        totalCalls: stats.totalCalls,
        weeklyChange,
        averageDuration: stats.avgDuration,
        overallMood: moodStats,
      },
      aiSummary,
      alerts,
      recentCalls,
    };
  }

  private generateAiSummary(
    recentCalls: Array<{ summary?: string | null; mood?: string | null }>,
    wardName?: string | null,
  ): string {
    if (recentCalls.length === 0) {
      return wardName
        ? `${wardName}님과의 최근 통화 기록이 없습니다.`
        : '최근 통화 기록이 없습니다.';
    }

    const latestCall = recentCalls[0];
    const displayName = wardName ?? '어르신';

    if (latestCall.mood === 'positive') {
      return `보호자님! ${displayName}님이 오늘 컨디션이 아주 좋으세요. ${latestCall.summary ?? ''}`;
    } else if (latestCall.mood === 'negative') {
      return `${displayName}님의 컨디션이 좋지 않아 보입니다. 관심이 필요해요. ${latestCall.summary ?? ''}`;
    }

    return `${displayName}님과 대화를 나눴어요. ${latestCall.summary ?? ''}`;
  }

  async getReport(userId: string, period: 'week' | 'month') {
    const { guardian } = await this.verifyGuardianAccess(userId);
    const days = period === 'month' ? 30 : 7;
    const linkedWard = await this.dbService.findWardByGuardianId(guardian.id);

    if (!linkedWard) {
      return {
        period,
        emotionTrend: [],
        healthKeywords: {},
        topTopics: [],
        weeklySummary: '연결된 어르신이 없습니다.',
        recommendations: [],
      };
    }

    this.logger.log(
      `getReport guardianId=${guardian.id} wardId=${linkedWard.id} period=${period}`,
    );

    const [emotionTrend, healthKeywords, topTopics, summaries] =
      await Promise.all([
        this.dbService.getEmotionTrend(linkedWard.id, days),
        this.dbService.getHealthKeywordStats(linkedWard.id, days),
        this.dbService.getTopTopics(linkedWard.id, days, 5),
        this.dbService.getCallSummariesForReport(linkedWard.id, days),
      ]);

    const summaryTexts = summaries
      .filter(s => s.summary)
      .map(s => s.summary)
      .slice(0, 3);
    const weeklySummary =
      summaryTexts.length > 0
        ? `최근 ${days}일간 ${summaries.length}건의 대화가 있었습니다. ${summaryTexts.join(' ')}`
        : `최근 ${days}일간 대화 기록이 없습니다.`;

    const recommendations: string[] = [];
    if (healthKeywords.pain.count > 0) {
      recommendations.push(
        '통증 관련 언급이 있었습니다. 건강 상태를 확인해보세요.',
      );
    }
    if (emotionTrend.some(e => e.mood === 'negative')) {
      recommendations.push(
        '부정적인 감정이 감지되었습니다. 대화를 나눠보세요.',
      );
    }
    if (summaries.length < 3) {
      recommendations.push('대화 빈도가 적습니다. 정기적인 통화를 권장합니다.');
    }

    return {
      period,
      emotionTrend,
      healthKeywords,
      topTopics,
      weeklySummary,
      recommendations,
    };
  }

  async getWards(userId: string) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log(`getWards guardianId=${guardian.id}`);

    const wards = await this.dbService.getGuardianWards(guardian.id);

    return {
      wards: wards.map(w => ({
        id: w.id,
        email: w.ward_email,
        phoneNumber: w.ward_phone_number,
        isPrimary: w.is_primary,
        nickname: w.ward_nickname,
        profileImageUrl: w.ward_profile_image_url,
        isLinked: w.linked_ward_id !== null,
        lastCallAt: w.last_call_at,
      })),
    };
  }

  async addWard(
    userId: string,
    wardEmail: string,
    wardPhoneNumber: string,
    options?: {
      wardBasicInfo?: {
        name?: string;
        relation?: string;
        phoneNumber?: string;
        birthDate?: string;
        gender?: string;
        address?: string;
      };
      aiCareInfo?: {
        medicalConditions?: string;
        medications?: string;
      };
      callSchedule?: {
        isEnabled: boolean;
        items: Array<{
          id?: string;
          slotStartHour: number;
          slotStartMinute: number;
          weekdays: number[];
          isEnabled: boolean;
        }>;
      };
    },
  ) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log(`addWard guardianId=${guardian.id} wardEmail=${wardEmail}`);

    const registration = await this.dbService.createGuardianWardRegistration({
      guardianId: guardian.id,
      wardEmail,
      wardPhoneNumber,
      wardName: options?.wardBasicInfo?.name,
      relation: options?.wardBasicInfo?.relation,
      birthDate: options?.wardBasicInfo?.birthDate,
      gender: options?.wardBasicInfo?.gender,
      address: options?.wardBasicInfo?.address,
      medicalConditions: options?.aiCareInfo?.medicalConditions,
      medications: options?.aiCareInfo?.medications,
    });

    // 스케줄 생성 (callSchedule이 있고 enabled인 경우)
    if (options?.callSchedule?.isEnabled && options.callSchedule.items.length > 0) {
      await this.dbService.createCallScheduleGroups(
        registration.id,
        null,
        options.callSchedule.items,
      );
    }

    return {
      id: registration.id,
      wardEmail: registration.ward_email,
      wardPhoneNumber: registration.ward_phone_number,
      isLinked: false,
    };
  }

  async updateWard(
    userId: string,
    wardId: string,
    wardEmail: string,
    wardPhoneNumber: string,
  ) {
    const { guardian } = await this.verifyGuardianAccess(userId);

    const registration = await this.dbService.findGuardianWardRegistration(
      wardId,
      guardian.id,
    );
    if (!registration) {
      throw new HttpException(
        'Ward registration not found',
        HttpStatus.NOT_FOUND,
      );
    }

    this.logger.log(`updateWard registrationId=${wardId}`);
    const updated = await this.dbService.updateGuardianWardRegistration({
      id: wardId,
      guardianId: guardian.id,
      wardEmail,
      wardPhoneNumber,
    });

    if (!updated) {
      throw new HttpException(
        'Failed to update ward registration',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }

    return {
      id: updated.id,
      wardEmail: updated.ward_email,
      wardPhoneNumber: updated.ward_phone_number,
      linkedWard: updated.linked_ward_id
        ? {
            id: updated.linked_ward_id,
            nickname: null,
            profileImageUrl: null,
          }
        : null,
      updatedAt: updated.updated_at,
    };
  }

  async deleteWard(userId: string, wardId: string) {
    const { guardian } = await this.verifyGuardianAccess(userId);

    // Primary ward인 경우 연결만 해제
    if (wardId === guardian.id) {
      await this.dbService.unlinkPrimaryWard(guardian.id);
      return;
    }

    // 추가 등록 삭제 (deleteGuardianWardRegistration 내부에서 ward 연결 해제 처리)
    this.logger.log(`deleteWard registrationId=${wardId}`);
    const deleted = await this.dbService.deleteGuardianWardRegistration(
      wardId,
      guardian.id,
    );
    if (!deleted) {
      throw new HttpException(
        'Ward registration not found',
        HttpStatus.NOT_FOUND,
      );
    }
  }

  async getNotificationSettings(userId: string) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log('getNotificationSettings guardianId=' + guardian.id);

    const settings = await this.dbService.getNotificationSettings(userId);

    return {
      callReminder: settings?.call_reminder ?? true,
      callComplete: settings?.call_complete ?? true,
      healthAlert: settings?.health_alert ?? true,
    };
  }

  async updateNotificationSettings(
    userId: string,
    settings: {
      callReminder?: boolean;
      callComplete?: boolean;
      healthAlert?: boolean;
    },
  ) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log('updateNotificationSettings guardianId=' + guardian.id);

    const updated = await this.dbService.upsertNotificationSettings({
      userId,
      callReminder: settings.callReminder,
      callComplete: settings.callComplete,
      healthAlert: settings.healthAlert,
    });

    return {
      callReminder: updated.call_reminder,
      callComplete: updated.call_complete,
      healthAlert: updated.health_alert,
    };
  }

  async getSchedules(userId: string, wardId?: string) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log(`getSchedules guardianId=${guardian.id} wardId=${wardId ?? 'all'}`);

    const schedules = await this.dbService.getCallScheduleGroups(guardian.id);

    // wardId가 제공된 경우 해당 어르신의 스케줄만 필터링
    const filteredSchedules = wardId
      ? schedules.filter(s => s.ward_id === wardId)
      : schedules;

    return {
      wardId: wardId ?? null,
      isEnabled: filteredSchedules.length > 0 && filteredSchedules.some(s => s.is_enabled),
      items: filteredSchedules.map(s => ({
        id: s.id,
        slotStartHour: s.slot_start_hour,
        slotStartMinute: s.slot_start_minute,
        weekdays: s.weekdays,
        isEnabled: s.is_enabled,
      })),
    };
  }

  async getSlotAvailability(userId: string, hour: number, minute: number) {
    await this.verifyGuardianAccess(userId);
    return this.dbService.getSlotAvailability(hour, minute);
  }

  async updateSchedules(
    userId: string,
    body: {
      wardId?: string;
      isEnabled: boolean;
      items: Array<{
        id?: string;
        slotStartHour: number;
        slotStartMinute: number;
        weekdays: number[];
        isEnabled: boolean;
      }>;
    },
  ) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log(`updateSchedules guardianId=${guardian.id} wardId=${body.wardId ?? 'auto'}`);

    // wardId가 제공되면 해당 어르신 사용, 아니면 첫 번째 연동된 어르신
    let targetWard: { id: string } | null = null;
    if (body.wardId) {
      // 제공된 wardId가 이 보호자의 어르신인지 확인
      const ward = await this.dbService.findWardById(body.wardId);
      if (ward && ward.guardian_id === guardian.id) {
        targetWard = { id: ward.id };
      } else {
        throw new HttpException(
          {
            success: false,
            error: {
              code: 'WARD_NOT_FOUND',
              message: '어르신을 찾을 수 없습니다.',
            },
          },
          HttpStatus.NOT_FOUND,
        );
      }
    } else {
      targetWard = (await this.dbService.findWardByGuardianId(guardian.id)) ?? null;
    }

    const slotConfig = await this.dbService.getSlotConfig();

    // 입력값 유효성 검증 (형식 검증만 - 용량 검증은 아래에서 원자적으로 수행)
    for (const item of body.items) {
      // 시간 범위 검증
      if (item.slotStartHour < 0 || item.slotStartHour > 23) {
        throw new HttpException(
          {
            success: false,
            error: {
              code: 'INVALID_HOUR',
              message: `유효하지 않은 시간입니다: ${item.slotStartHour}`,
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 10분 단위 검증
      if (!slotConfig.validMinutes.includes(item.slotStartMinute)) {
        throw new HttpException(
          {
            success: false,
            error: {
              code: 'INVALID_MINUTE',
              message: `분은 10분 단위여야 합니다: ${item.slotStartMinute}`,
              details: { validMinutes: slotConfig.validMinutes },
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }

      // 요일 배열 검증
      if (
        !Array.isArray(item.weekdays) ||
        item.weekdays.length === 0 ||
        item.weekdays.some(w => w < 0 || w > 6)
      ) {
        throw new HttpException(
          {
            success: false,
            error: {
              code: 'INVALID_WEEKDAYS',
              message: '유효하지 않은 요일 배열입니다',
            },
          },
          HttpStatus.BAD_REQUEST,
        );
      }
    }

    // 기존 스케줄 삭제
    await this.dbService.deleteCallScheduleGroupsByGuardian(guardian.id);

    if (body.isEnabled && body.items.length > 0) {
      // targetWard가 있으면 wardId로, 없으면 registration으로
      const registration = await this.dbService.findFirstGuardianWardRegistration(guardian.id);

      // SELECT FOR UPDATE를 사용한 원자적 검증 + 삽입
      // Race condition 방지: 100개 동시 요청이 와도 순차 처리됨
      const result = await this.dbService.createCallScheduleGroupsWithLock(
        registration?.id ?? null,
        targetWard?.id ?? null,
        body.items,
        slotConfig.maxCapacityPerSlot,
      );

      if (!result.success && result.error) {
        throw new HttpException(
          {
            success: false,
            error: result.error,
          },
          HttpStatus.CONFLICT,
        );
      }
    }

    return this.getSchedules(userId, body.wardId);
  }

  async deleteSchedule(userId: string, scheduleId: string) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log(`deleteSchedule guardianId=${guardian.id} scheduleId=${scheduleId}`);

    const deleted = await this.dbService.deleteCallScheduleGroup(scheduleId, guardian.id);
    if (!deleted) {
      throw new HttpException('Schedule not found', HttpStatus.NOT_FOUND);
    }
  }
}
