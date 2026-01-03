/**
 * Ward Repository
 * wards, organization_wards, call_schedules 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { Prisma } from '@prisma/client';
import { WardRow } from '../types';
import { toWardRow } from '../prisma-mappers';

export enum BeneficiaryStatus {
  WARNING = 'WARNING',
  CAUTION = 'CAUTION',
  NORMAL = 'NORMAL',
}

export interface BeneficiaryListItem {
  id: string;
  name: string;
  address: string | null;
  manager: string | null;
  status: BeneficiaryStatus;
  lastCall: string | null;
}

export interface BeneficiaryListResult {
  data: BeneficiaryListItem[];
  total: number;
}

@Injectable()
export class WardRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    userId: string;
    phoneNumber: string;
    guardianId: string | null;
  }): Promise<WardRow> {
    const ward = await this.prisma.ward.create({
      data: {
        userId: params.userId,
        phoneNumber: params.phoneNumber,
        guardianId: params.guardianId,
      },
    });
    return toWardRow(ward);
  }

  async findByUserId(userId: string): Promise<WardRow | undefined> {
    const ward = await this.prisma.ward.findUnique({
      where: { userId },
    });
    return ward ? toWardRow(ward) : undefined;
  }

  async findById(wardId: string): Promise<WardRow | undefined> {
    const ward = await this.prisma.ward.findUnique({
      where: { id: wardId },
    });
    return ward ? toWardRow(ward) : undefined;
  }

  async findByGuardianId(guardianId: string): Promise<
    | (WardRow & {
        user_nickname: string | null;
        user_profile_image_url: string | null;
      })
    | undefined
  > {
    const ward = await this.prisma.ward.findFirst({
      where: { guardianId },
      include: {
        user: {
          select: {
            nickname: true,
            profileImageUrl: true,
          },
        },
      },
    });
    if (!ward) return undefined;
    return {
      ...toWardRow(ward),
      user_nickname: ward.user.nickname,
      user_profile_image_url: ward.user.profileImageUrl,
    };
  }

  async getCallStats(wardId: string) {
    const ward = await this.prisma.ward.findUnique({
      where: { id: wardId },
      select: { userId: true },
    });
    if (!ward) return { totalCalls: 0, avgDuration: 0 };

    const calls = await this.prisma.call.findMany({
      where: {
        calleeUserId: ward.userId,
        state: 'ended',
        answeredAt: { not: null },
      },
      select: {
        answeredAt: true,
        endedAt: true,
      },
    });

    const totalCalls = calls.length;
    let totalDuration = 0;
    for (const call of calls) {
      if (call.answeredAt && call.endedAt) {
        totalDuration +=
          (call.endedAt.getTime() - call.answeredAt.getTime()) / 60000;
      }
    }
    const avgDuration =
      totalCalls > 0 ? Math.round(totalDuration / totalCalls) : 0;

    return { totalCalls, avgDuration };
  }

  async getWeeklyCallChange(wardId: string): Promise<number> {
    const ward = await this.prisma.ward.findUnique({
      where: { id: wardId },
      select: { userId: true },
    });
    if (!ward) return 0;

    const now = new Date();
    const oneWeekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    const twoWeeksAgo = new Date(now.getTime() - 14 * 24 * 60 * 60 * 1000);

    const thisWeek = await this.prisma.call.count({
      where: {
        calleeUserId: ward.userId,
        state: 'ended',
        createdAt: { gte: oneWeekAgo },
      },
    });

    const lastWeek = await this.prisma.call.count({
      where: {
        calleeUserId: ward.userId,
        state: 'ended',
        createdAt: { gte: twoWeeksAgo, lt: oneWeekAgo },
      },
    });

    return thisWeek - lastWeek;
  }

  async getMoodStats(wardId: string) {
    const summaries = await this.prisma.callSummary.groupBy({
      by: ['mood'],
      where: { wardId, mood: { not: null } },
      _count: true,
    });

    let positive = 0;
    let negative = 0;
    let neutral = 0;

    for (const s of summaries) {
      if (s.mood === 'positive') positive = s._count;
      else if (s.mood === 'negative') negative = s._count;
      else neutral = s._count;
    }

    const total = positive + negative + neutral;
    if (total === 0) return { positive: 0, negative: 0 };

    return {
      positive: Math.round((positive / total) * 100),
      negative: Math.round((negative / total) * 100),
    };
  }

  async getEmotionTrend(wardId: string, days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const summaries = await this.prisma.callSummary.findMany({
      where: {
        wardId,
        createdAt: { gte: cutoff },
      },
      select: {
        createdAt: true,
        moodScore: true,
        mood: true,
      },
      orderBy: { createdAt: 'asc' },
    });

    // Group by date
    const dateMap = new Map<string, { scores: number[]; moods: string[] }>();
    for (const s of summaries) {
      const date = s.createdAt.toISOString().split('T')[0];
      if (!dateMap.has(date)) {
        dateMap.set(date, { scores: [], moods: [] });
      }
      const entry = dateMap.get(date)!;
      if (s.moodScore) entry.scores.push(Number(s.moodScore));
      if (s.mood) entry.moods.push(s.mood);
    }

    const results: Array<{ date: string; score: number; mood: string }> = [];
    for (const [date, data] of dateMap) {
      const avgScore =
        data.scores.length > 0
          ? data.scores.reduce((a, b) => a + b, 0) / data.scores.length
          : 0;
      // Mode of moods
      const moodCounts: Record<string, number> = {};
      for (const m of data.moods) {
        moodCounts[m] = (moodCounts[m] || 0) + 1;
      }
      const topMood =
        Object.entries(moodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] ||
        'neutral';
      results.push({ date, score: avgScore, mood: topMood });
    }

    return results;
  }

  async getHealthKeywordStats(wardId: string, days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const summaries = await this.prisma.callSummary.findMany({
      where: {
        wardId,
        createdAt: { gte: cutoff },
        healthKeywords: { not: Prisma.DbNull },
      },
      select: { healthKeywords: true },
    });

    const keywordCounts: Record<string, number> = {};
    for (const row of summaries) {
      const keywords = row.healthKeywords as Record<string, unknown> | null;
      if (keywords) {
        for (const [key, value] of Object.entries(keywords)) {
          if (typeof value === 'number') {
            keywordCounts[key] = (keywordCounts[key] || 0) + value;
          } else {
            keywordCounts[key] = (keywordCounts[key] || 0) + 1;
          }
        }
      }
    }

    return {
      pain: { count: keywordCounts['pain'] || 0, trend: 'stable' },
      sleep: { status: 'normal', mentions: keywordCounts['sleep'] || 0 },
      meal: { status: 'regular', mentions: keywordCounts['meal'] || 0 },
      medication: {
        status: 'compliant',
        mentions: keywordCounts['medication'] || 0,
      },
    };
  }

  async getTopTopics(wardId: string, days: number, limit: number = 5) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const summaries = await this.prisma.callSummary.findMany({
      where: {
        wardId,
        createdAt: { gte: cutoff },
        tags: { isEmpty: false },
      },
      select: { tags: true },
    });

    const topicCounts: Record<string, number> = {};
    for (const row of summaries) {
      if (row.tags) {
        for (const tag of row.tags) {
          topicCounts[tag] = (topicCounts[tag] || 0) + 1;
        }
      }
    }

    return Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([topic, count]) => ({ topic, count }));
  }

  async updateSettings(params: {
    wardId: string;
    aiPersona?: string;
    weeklyCallCount?: number;
    callDurationMinutes?: number;
  }): Promise<WardRow | undefined> {
    try {
      const updateData: {
        aiPersona?: string;
        weeklyCallCount?: number;
        callDurationMinutes?: number;
      } = {};

      if (params.aiPersona !== undefined)
        updateData.aiPersona = params.aiPersona;
      if (params.weeklyCallCount !== undefined)
        updateData.weeklyCallCount = params.weeklyCallCount;
      if (params.callDurationMinutes !== undefined)
        updateData.callDurationMinutes = params.callDurationMinutes;

      if (Object.keys(updateData).length === 0) return undefined;

      // Note: params.wardId is actually userId based on original SQL
      const ward = await this.prisma.ward.update({
        where: { userId: params.wardId },
        data: updateData,
      });
      return toWardRow(ward);
    } catch {
      return undefined;
    }
  }

  async getWithGuardianInfo(wardId: string) {
    const ward = await this.prisma.ward.findUnique({
      where: { id: wardId },
      include: {
        user: {
          select: {
            identity: true,
            nickname: true,
            displayName: true,
          },
        },
        guardian: {
          include: {
            user: {
              select: {
                id: true,
                identity: true,
              },
            },
          },
        },
      },
    });

    if (!ward) return undefined;

    return {
      ward_id: ward.id,
      ward_user_id: ward.userId,
      ward_identity: ward.user.identity,
      ward_name: ward.user.nickname ?? ward.user.displayName,
      guardian_id: ward.guardianId,
      guardian_user_id: ward.guardian?.userId ?? null,
      guardian_identity: ward.guardian?.user.identity ?? null,
    };
  }

  // Organization Wards methods
  async findOrganizationWard(organizationId: string, email: string) {
    const orgWard = await this.prisma.organizationWard.findUnique({
      where: {
        organizationId_email: { organizationId, email },
      },
      select: {
        id: true,
        organizationId: true,
        email: true,
      },
    });
    if (!orgWard) return undefined;
    return {
      id: orgWard.id,
      organization_id: orgWard.organizationId,
      email: orgWard.email,
    };
  }

  /**
   * Find pending organization ward by email (across all organizations)
   * Used for auto-linking when ward signs up
   * Case-insensitive email matching
   */
  async findPendingOrganizationWardByEmail(email: string) {
    const normalizedEmail = email.toLowerCase().trim();
    const orgWard = await this.prisma.organizationWard.findFirst({
      where: {
        email: { equals: normalizedEmail, mode: 'insensitive' },
        isRegistered: false,
        wardId: null,
      },
      orderBy: { createdAt: 'asc' }, // Match oldest registration first
    });
    if (!orgWard) return undefined;
    return {
      id: orgWard.id,
      organization_id: orgWard.organizationId,
      email: orgWard.email,
    };
  }

  /**
   * Link organization ward to actual ward (auto-approval)
   */
  async linkOrganizationWard(params: {
    organizationWardId: string;
    wardId: string;
  }): Promise<void> {
    await this.prisma.organizationWard.update({
      where: { id: params.organizationWardId },
      data: {
        isRegistered: true,
        wardId: params.wardId,
      },
    });
  }

  /**
   * Update ward's organization ID
   */
  async updateWardOrganization(params: {
    wardId: string;
    organizationId: string;
  }): Promise<void> {
    await this.prisma.ward.update({
      where: { id: params.wardId },
      data: { organizationId: params.organizationId },
    });
  }

  async createOrganizationWard(params: {
    organizationId: string;
    email: string;
    phoneNumber: string;
    name: string;
    birthDate: string | null;
    address: string | null;
    uploadedByAdminId?: string;
    notes?: string;
  }) {
    const orgWard = await this.prisma.organizationWard.create({
      data: {
        organizationId: params.organizationId,
        uploadedByAdminId: params.uploadedByAdminId ?? null,
        email: params.email,
        phoneNumber: params.phoneNumber,
        name: params.name,
        birthDate: params.birthDate ? new Date(params.birthDate) : null,
        address: params.address,
        // 신규 등록은 기본적으로 미연동 상태
        isRegistered: false,
        wardId: null,
        notes: params.notes ?? null,
      },
    });

    return {
      id: orgWard.id,
      organization_id: orgWard.organizationId,
      uploaded_by_admin_id: orgWard.uploadedByAdminId,
      email: orgWard.email,
      phone_number: orgWard.phoneNumber,
      name: orgWard.name,
      birth_date: orgWard.birthDate?.toISOString().split('T')[0] ?? null,
      address: orgWard.address,
      notes: orgWard.notes,
      is_registered: orgWard.isRegistered,
      ward_id: orgWard.wardId,
      created_at: orgWard.createdAt.toISOString(),
    };
  }

  async getOrganizationWards(organizationId: string) {
    const wards = await this.prisma.organizationWard.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });

    return wards.map(w => ({
      id: w.id,
      email: w.email,
      phone_number: w.phoneNumber,
      name: w.name,
      birth_date: w.birthDate?.toISOString().split('T')[0] ?? null,
      address: w.address,
      notes: w.notes,
      is_registered: w.isRegistered,
      ward_id: w.wardId,
      uploaded_by_admin_id: w.uploadedByAdminId,
      created_at: w.createdAt.toISOString(),
    }));
  }

  async getMyManagedWards(adminId: string) {
    const wards = await this.prisma.organizationWard.findMany({
      where: { uploadedByAdminId: adminId },
      include: {
        organization: { select: { name: true } },
        ward: {
          include: {
            callSummaries: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { mood: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const results: Array<{
      id: string;
      organization_id: string;
      organization_name: string;
      email: string;
      phone_number: string;
      name: string;
      birth_date: string | null;
      address: string | null;
      notes: string | null;
      is_registered: boolean;
      ward_id: string | null;
      created_at: string;
      last_call_at: string | null;
      total_calls: string;
      last_mood: string | null;
    }> = [];

    for (const ow of wards) {
      // Get call stats for linked ward
      let lastCallAt: string | null = null;
      let totalCalls = '0';

      if (ow.ward) {
        const calls = await this.prisma.call.findMany({
          where: { calleeUserId: ow.ward.userId, state: 'ended' },
          orderBy: { createdAt: 'desc' },
          take: 1,
          select: { createdAt: true },
        });
        lastCallAt = calls[0]?.createdAt.toISOString() ?? null;

        const count = await this.prisma.call.count({
          where: { calleeUserId: ow.ward.userId, state: 'ended' },
        });
        totalCalls = count.toString();
      }

      results.push({
        id: ow.id,
        organization_id: ow.organizationId,
        organization_name: ow.organization.name,
        email: ow.email,
        phone_number: ow.phoneNumber,
        name: ow.name,
        birth_date: ow.birthDate?.toISOString().split('T')[0] ?? null,
        address: ow.address,
        notes: ow.notes,
        is_registered: ow.isRegistered,
        ward_id: ow.wardId,
        created_at: ow.createdAt.toISOString(),
        last_call_at: lastCallAt,
        total_calls: totalCalls,
        last_mood: ow.ward?.callSummaries[0]?.mood ?? null,
      });
    }

    return results;
  }

  async getMyManagedWardsStats(adminId: string) {
    const [total, registered, pending] = await Promise.all([
      this.prisma.organizationWard.count({
        where: { uploadedByAdminId: adminId },
      }),
      this.prisma.organizationWard.count({
        where: { uploadedByAdminId: adminId, isRegistered: true },
      }),
      this.prisma.organizationWard.count({
        where: { uploadedByAdminId: adminId, isRegistered: false },
      }),
    ]);

    // Get ward IDs managed by this admin
    const managedWards = await this.prisma.organizationWard.findMany({
      where: { uploadedByAdminId: adminId, wardId: { not: null } },
      select: { wardId: true },
    });
    const wardIds = managedWards
      .map(w => w.wardId)
      .filter((id): id is string => id !== null);

    let positiveMood = 0;
    let negativeMood = 0;

    if (wardIds.length > 0) {
      const [positive, negative] = await Promise.all([
        this.prisma.callSummary.count({
          where: { wardId: { in: wardIds }, mood: 'positive' },
        }),
        this.prisma.callSummary.count({
          where: { wardId: { in: wardIds }, mood: 'negative' },
        }),
      ]);
      positiveMood = positive;
      negativeMood = negative;
    }

    return { total, registered, pending, positiveMood, negativeMood };
  }

  // Call Schedule methods
  async getUpcomingCallSchedules(
    dayOfWeek: number,
    startTime: string,
    endTime: string,
  ) {
    // Get all schedules for this day
    const schedules = await this.prisma.callSchedule.findMany({
      where: {
        dayOfWeek,
        isActive: true,
      },
      include: {
        ward: {
          include: {
            user: { select: { identity: true } },
            guardian: {
              include: {
                user: { select: { id: true, identity: true } },
              },
            },
          },
        },
      },
    });

    // Filter by time range and reminder sent
    const now = new Date();
    const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);

    return schedules
      .filter(s => {
        const schedTime = s.scheduledTime;
        const hours = schedTime.getUTCHours().toString().padStart(2, '0');
        const mins = schedTime.getUTCMinutes().toString().padStart(2, '0');
        const timeStr = `${hours}:${mins}:00`;
        const inRange = timeStr >= startTime && timeStr < endTime;
        const notRecentlySent =
          !s.reminderSentAt || s.reminderSentAt < oneHourAgo;
        return inRange && notRecentlySent;
      })
      .map(s => ({
        id: s.id,
        ward_id: s.wardId,
        ward_user_id: s.ward.userId,
        ward_identity: s.ward.user.identity,
        ai_persona: s.ward.aiPersona ?? '다미',
        guardian_id: s.ward.guardianId,
        guardian_user_id: s.ward.guardian?.userId ?? null,
        guardian_identity: s.ward.guardian?.user.identity ?? null,
      }));
  }

  async markReminderSent(scheduleId: string): Promise<void> {
    await this.prisma.callSchedule.update({
      where: { id: scheduleId },
      data: { reminderSentAt: new Date() },
    });
  }

  async listOrganizationBeneficiaries(params: {
    organizationId: string;
    search?: string;
    riskOnly?: boolean;
    page: number;
    pageSize: number;
  }): Promise<BeneficiaryListResult> {
    const { organizationId, search, riskOnly = false, page, pageSize } = params;

    // 연동 완료된(isRegistered=true) 대상자만 전체 대상자 관리에 노출
    const where: Prisma.OrganizationWardWhereInput = {
      organizationId,
      isRegistered: true,
    };
    const q = search?.trim();
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { address: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { phoneNumber: { contains: q, mode: 'insensitive' } },
      ];
    }
    if (riskOnly) {
      // 위험/주의 상태를 가진 최근 통화 요약이 있는 대상자만 조회
      where.ward = {
        callSummaries: { some: { mood: { in: ['negative', 'neutral'] } } },
      };
    }

    const total = await this.prisma.organizationWard.count({ where });
    const rows = await this.prisma.organizationWard.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * pageSize,
      take: pageSize,
      include: {
        uploadedByAdmin: { select: { name: true, email: true } },
        ward: {
          include: {
            callSummaries: {
              orderBy: { createdAt: 'desc' },
              take: 1,
              select: { mood: true, call: { select: { createdAt: true } } },
            },
          },
        },
      },
    });

    const data = rows.map(row => {
      const mood = row.ward?.callSummaries[0]?.mood;
      let status = BeneficiaryStatus.NORMAL;
      if (mood === 'negative') status = BeneficiaryStatus.WARNING;
      else if (mood === 'neutral') status = BeneficiaryStatus.CAUTION;

      const lastCall =
        row.ward?.callSummaries[0]?.call?.createdAt?.toISOString() ?? null;

      return {
        id: row.id,
        name: row.name,
        address: row.address,
        manager:
          row.uploadedByAdmin?.name ?? row.uploadedByAdmin?.email ?? null,
        status,
        lastCall,
      };
    });

    return { data, total };
  }
}
