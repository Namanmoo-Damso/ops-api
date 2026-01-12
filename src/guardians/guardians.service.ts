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

  async getDashboard(userId: string, period?: 'today' | 'week' | 'month') {
    const { guardian } = await this.verifyGuardianAccess(userId);
    const linkedWard = await this.dbService.findWardByGuardianId(guardian.id);

    if (!linkedWard) {
      return {
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
      `getDashboard guardianId=${guardian.id} wardId=${linkedWard.id} period=${period ?? 'default'}`,
    );

    // 기간에 따른 일수 계산
    const days = period === 'today' ? 1 : period === 'month' ? 30 : 7;

    const [stats, weeklyChange, moodStats, alerts, recentCalls] =
      await Promise.all([
        this.dbService.getWardCallStats(linkedWard.id, days),
        this.dbService.getWardWeeklyCallChange(linkedWard.id),
        this.dbService.getWardMoodStats(linkedWard.id, days),
        this.dbService.getHealthAlerts(guardian.id, 5),
        this.dbService.getRecentCallSummaries(linkedWard.id, 5),
      ]);

    // aiSummary 생성 (최근 통화 기반)
    const aiSummary = this.generateAiSummary(recentCalls, linkedWard.user_nickname);

    return {
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
          time: string;
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

  async getSchedules(userId: string) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log(`getSchedules guardianId=${guardian.id}`);

    const schedules = await this.dbService.getCallScheduleGroups(guardian.id);

    return {
      isEnabled: schedules.length > 0 && schedules.some(s => s.is_enabled),
      items: schedules.map(s => ({
        id: s.id,
        time: s.time,
        weekdays: s.weekdays,
        isEnabled: s.is_enabled,
      })),
    };
  }

  async updateSchedules(
    userId: string,
    body: {
      isEnabled: boolean;
      items: Array<{
        id?: string;
        time: string;
        weekdays: number[];
        isEnabled: boolean;
      }>;
    },
  ) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log(`updateSchedules guardianId=${guardian.id}`);

    const linkedWard = await this.dbService.findWardByGuardianId(guardian.id);

    // 기존 스케줄 삭제 후 새로 생성 (upsert 방식)
    await this.dbService.deleteCallScheduleGroupsByGuardian(guardian.id);

    if (body.isEnabled && body.items.length > 0) {
      // linkedWard가 있으면 wardId로, 없으면 registration으로
      const registration = await this.dbService.findFirstGuardianWardRegistration(guardian.id);

      await this.dbService.createCallScheduleGroups(
        registration?.id ?? null,
        linkedWard?.id ?? null,
        body.items,
      );
    }

    return this.getSchedules(userId);
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
