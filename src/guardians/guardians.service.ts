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

  async getDashboard(userId: string) {
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
        alerts: [],
        recentCalls: [],
      };
    }

    this.logger.log(
      `getDashboard guardianId=${guardian.id} wardId=${linkedWard.id}`,
    );

    const [stats, weeklyChange, moodStats, alerts, recentCalls] =
      await Promise.all([
        this.dbService.getWardCallStats(linkedWard.id),
        this.dbService.getWardWeeklyCallChange(linkedWard.id),
        this.dbService.getWardMoodStats(linkedWard.id),
        this.dbService.getHealthAlerts(guardian.id, 5),
        this.dbService.getRecentCallSummaries(linkedWard.id, 5),
      ]);

    return {
      statistics: {
        totalCalls: stats.totalCalls,
        weeklyChange,
        averageDuration: stats.avgDuration,
        overallMood: moodStats,
      },
      alerts,
      recentCalls,
    };
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

  async addWard(userId: string, wardEmail: string, wardPhoneNumber: string) {
    const { guardian } = await this.verifyGuardianAccess(userId);
    this.logger.log(`addWard guardianId=${guardian.id} wardEmail=${wardEmail}`);

    const registration = await this.dbService.createGuardianWardRegistration({
      guardianId: guardian.id,
      wardEmail,
      wardPhoneNumber,
    });

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
}
