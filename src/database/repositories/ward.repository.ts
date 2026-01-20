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
  age: number | null;
  gender: string | null;
  type: string | null;
  address: string | null;
  manager: string | null;
  status: BeneficiaryStatus;
  lastCall: string | null;
}

export interface BeneficiaryListResult {
  data: BeneficiaryListItem[];
  total: number;
}

export interface BeneficiaryDetailLog {
  id: string;
  date: string;
  type: string;
  content: string;
  sentiment?: 'positive' | 'neutral' | 'negative';
}

export interface BeneficiaryDetailItem {
  id: string;
  name: string;
  email: string;
  phoneNumber: string | null;
  birthDate: string | null;
  address: string | null;
  gender: string | null;
  type: string | null;
  guardian: string | null;
  diseases: string[];
  medication: string | null;
  notes: string | null;
  recentLogs: BeneficiaryDetailLog[];
}

export interface BeneficiaryDeleteInfo {
  id: string;
  ward_user_id: string | null;
}

export interface BeneficiaryUpdateInput {
  name?: string;
  phoneNumber?: string | null;
  birthDate?: string | null;
  address?: string | null;
  gender?: string | null;
  wardType?: string | null;
  guardian?: string | null;
  diseases?: string[];
  medication?: string | null;
  notes?: string | null;
}

const beneficiaryDetailInclude = {
  ward: {
    include: {
      guardian: {
        include: {
          user: {
            select: {
              displayName: true,
              nickname: true,
              email: true,
            },
          },
        },
      },
      callSummaries: {
        orderBy: { createdAt: 'desc' },
        take: 10,
        select: {
          id: true,
          summary: true,
          mood: true,
          createdAt: true,
          call: { select: { createdAt: true } },
        },
      },
    },
  },
} satisfies Prisma.OrganizationWardInclude;

type OrganizationWardWithDetail = Prisma.OrganizationWardGetPayload<{
  include: typeof beneficiaryDetailInclude;
}>;

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

  /**
   * Find ward by user identity (e.g., kakao_xxx)
   * Used when we have the participant identity from LiveKit but not the user UUID
   */
  async findByUserIdentity(identity: string): Promise<WardRow | undefined> {
    const user = await this.prisma.user.findUnique({
      where: { identity },
      include: { ward: true },
    });
    if (!user?.ward) return undefined;
    return toWardRow(user.ward);
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
    // guardian_ward_registrations를 통해 연결된 ward 조회
    const registration = await this.prisma.guardianWardRegistration.findFirst({
      where: {
        guardianId,
        linkedWardId: { not: null },
      },
      select: { linkedWardId: true },
    });

    if (!registration?.linkedWardId) {
      // fallback: 기존 방식 (wards.guardian_id로 직접 연결)
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

    const ward = await this.prisma.ward.findUnique({
      where: { id: registration.linkedWardId },
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

  async getCallStats(wardId: string, days?: number) {
    const ward = await this.prisma.ward.findUnique({
      where: { id: wardId },
      select: { userId: true },
    });
    if (!ward) return { totalCalls: 0, avgDuration: 0 };

    const cutoff = days
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      : undefined;

    const calls = await this.prisma.call.findMany({
      where: {
        calleeUserId: ward.userId,
        state: 'ended',
        answeredAt: { not: null },
        ...(cutoff && { createdAt: { gte: cutoff } }),
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

  async getMoodStats(wardId: string, days?: number) {
    const cutoff = days
      ? new Date(Date.now() - days * 24 * 60 * 60 * 1000)
      : undefined;

    const summaries = await this.prisma.callSummary.groupBy({
      by: ['mood'],
      where: {
        wardId,
        mood: { not: null },
        ...(cutoff && { createdAt: { gte: cutoff } }),
      },
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
      phone_number: orgWard.phoneNumber,
      name: orgWard.name,
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
    gender?: string;
    diseases?: string[];
    medication?: string;
    emergencyContact?: string;
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
        gender: params.gender ?? null,
        diseases: params.diseases ?? [],
        medication: params.medication ?? null,
        emergencyContact: params.emergencyContact ?? null,
        notes: params.notes ?? null,
        // 신규 등록은 기본적으로 미연동 상태
        isRegistered: false,
        wardId: null,
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
      gender: orgWard.gender,
      diseases: orgWard.diseases,
      medication: orgWard.medication,
      emergency_contact: orgWard.emergencyContact,
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
        wardAssignments: {
          where: { isActive: true },
          take: 1,
          include: {
            staff: {
              select: { id: true, name: true },
            },
          },
        },
      },
    });

    // Collect all ward userIds for batch query
    const wardUserIds = wards
      .filter(ow => ow.ward?.userId)
      .map(ow => ow.ward!.userId);

    // Batch query: get last call and count for all wards at once
    const [lastCalls, callCounts] =
      wardUserIds.length > 0
        ? await Promise.all([
            this.prisma.call.groupBy({
              by: ['calleeUserId'],
              where: { calleeUserId: { in: wardUserIds }, state: 'ended' },
              _max: { createdAt: true },
            }),
            this.prisma.call.groupBy({
              by: ['calleeUserId'],
              where: { calleeUserId: { in: wardUserIds }, state: 'ended' },
              _count: true,
            }),
          ])
        : [[], []];

    const lastCallMap = new Map(
      lastCalls.map(c => [c.calleeUserId, c._max.createdAt]),
    );
    const countMap = new Map(callCounts.map(c => [c.calleeUserId, c._count]));

    return wards.map(ow => {
      const userId = ow.ward?.userId;
      const lastCallAt = userId
        ? (lastCallMap.get(userId)?.toISOString() ?? null)
        : null;
      const totalCalls = userId ? (countMap.get(userId) ?? 0).toString() : '0';
      const assignedStaff = ow.wardAssignments[0]?.staff ?? null;

      return {
        id: ow.id,
        organization_id: ow.organizationId,
        organization_name: ow.organization.name,
        email: ow.email,
        phone_number: ow.phoneNumber,
        name: ow.name,
        birth_date: ow.birthDate?.toISOString().split('T')[0] ?? null,
        address: ow.address,
        gender: ow.gender ?? null,
        diseases: ow.diseases,
        medication: ow.medication ?? null,
        emergency_contact: ow.emergencyContact ?? null,
        notes: ow.notes ?? null,
        is_registered: ow.isRegistered,
        ward_id: ow.wardId,
        created_at: ow.createdAt.toISOString(),
        last_call_at: lastCallAt,
        total_calls: totalCalls,
        last_mood: ow.ward?.callSummaries[0]?.mood ?? null,
        assigned_staff_id: assignedStaff?.id ?? null,
        assigned_staff_name: assignedStaff?.name ?? null,
      };
    });
  }

  async getOrganizationWardsStats(organizationId: string) {
    const [total, registered] = await Promise.all([
      this.prisma.organizationWard.count({
        where: { organizationId },
      }),
      this.prisma.organizationWard.count({
        where: { organizationId, isRegistered: true },
      }),
    ]);

    return { total, registered };
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

    // Collect all ward userIds for batch query
    const wardUserIds = wards
      .filter(ow => ow.ward?.userId)
      .map(ow => ow.ward!.userId);

    // Batch query: get last call and count for all wards at once
    const [lastCalls, callCounts] =
      wardUserIds.length > 0
        ? await Promise.all([
            this.prisma.call.groupBy({
              by: ['calleeUserId'],
              where: { calleeUserId: { in: wardUserIds }, state: 'ended' },
              _max: { createdAt: true },
            }),
            this.prisma.call.groupBy({
              by: ['calleeUserId'],
              where: { calleeUserId: { in: wardUserIds }, state: 'ended' },
              _count: true,
            }),
          ])
        : [[], []];

    const lastCallMap = new Map(
      lastCalls.map(c => [c.calleeUserId, c._max.createdAt]),
    );
    const countMap = new Map(callCounts.map(c => [c.calleeUserId, c._count]));

    const results: Array<{
      id: string;
      organization_id: string;
      organization_name: string;
      email: string;
      phone_number: string;
      name: string;
      birth_date: string | null;
      address: string | null;
      gender: string | null;
      diseases: string[];
      medication: string | null;
      emergency_contact: string | null;
      notes: string | null;
      is_registered: boolean;
      ward_id: string | null;
      created_at: string;
      last_call_at: string | null;
      total_calls: string;
      last_mood: string | null;
    }> = [];

    for (const ow of wards) {
      const userId = ow.ward?.userId;
      const lastCallAt = userId
        ? (lastCallMap.get(userId)?.toISOString() ?? null)
        : null;
      const totalCalls = userId ? (countMap.get(userId) ?? 0).toString() : '0';

      results.push({
        id: ow.id,
        organization_id: ow.organizationId,
        organization_name: ow.organization.name,
        email: ow.email,
        phone_number: ow.phoneNumber,
        name: ow.name,
        birth_date: ow.birthDate?.toISOString().split('T')[0] ?? null,
        address: ow.address,
        gender: ow.gender ?? null,
        diseases: ow.diseases,
        medication: ow.medication ?? null,
        emergency_contact: ow.emergencyContact ?? null,
        notes: ow.notes ?? null,
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

  /**
   * Get usage stats for a specific beneficiary (organization ward)
   * Returns call statistics and dates with calls for the given period
   */
  async getBeneficiaryUsageStats(params: {
    organizationId: string;
    beneficiaryId: string;
    startDate: string;
    endDate: string;
  }): Promise<{
    totalCalls: number;
    totalDurationMinutes: number;
    averageDurationMinutes: number;
    callDates: string[];
    emergencyStats: {
      detected: number;
      responded: number;
    };
  } | null> {
    // First, get the organization ward and check if it's registered
    const orgWard = await this.prisma.organizationWard.findFirst({
      where: {
        id: params.beneficiaryId,
        organizationId: params.organizationId,
      },
      select: {
        wardId: true,
        ward: {
          select: { userId: true },
        },
      },
    });

    if (!orgWard) return null;

    // If not linked to a ward, return empty stats
    if (!orgWard.wardId || !orgWard.ward) {
      return {
        totalCalls: 0,
        totalDurationMinutes: 0,
        averageDurationMinutes: 0,
        callDates: [],
        emergencyStats: {
          detected: 0,
          responded: 0,
        },
      };
    }

    const startDate = new Date(params.startDate);
    startDate.setHours(0, 0, 0, 0);
    const endDate = new Date(params.endDate);
    endDate.setHours(23, 59, 59, 999);

    // Get all calls for this ward in the date range
    const calls = await this.prisma.call.findMany({
      where: {
        calleeUserId: orgWard.ward.userId,
        state: 'ended',
        answeredAt: { not: null },
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        createdAt: true,
        answeredAt: true,
        endedAt: true,
      },
    });

    // Get emergency stats from care_alert_events for this ward
    const [emergencyDetected, emergencyResponded] = await Promise.all([
      this.prisma.careAlertEvent.count({
        where: {
          wardId: orgWard.wardId,
          alertType: { not: 'emotion' },
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),
      this.prisma.careAlertEvent.count({
        where: {
          wardId: orgWard.wardId,
          alertType: { not: 'emotion' },
          acknowledged: true,
          timestamp: {
            gte: startDate,
            lte: endDate,
          },
        },
      }),
    ]);

    // Calculate stats
    const totalCalls = calls.length;
    let totalDurationMinutes = 0;
    const callDatesSet = new Set<string>();

    for (const call of calls) {
      // Add the date to the set
      callDatesSet.add(call.createdAt.toISOString().split('T')[0]);

      // Calculate duration
      if (call.answeredAt && call.endedAt) {
        const durationMs = call.endedAt.getTime() - call.answeredAt.getTime();
        totalDurationMinutes += durationMs / 60000;
      }
    }

    const averageDurationMinutes =
      totalCalls > 0
        ? Math.round((totalDurationMinutes / totalCalls) * 100) / 100
        : 0;

    return {
      totalCalls,
      totalDurationMinutes: Math.round(totalDurationMinutes * 100) / 100,
      averageDurationMinutes,
      callDates: Array.from(callDatesSet).sort(),
      emergencyStats: {
        detected: emergencyDetected,
        responded: emergencyResponded,
      },
    };
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

  /**
   * 현재 슬롯에 해당하는 스케줄 조회 (call_schedule_groups 테이블)
   * 자동 전화 발신용 - 10분 슬롯 기반
   */
  async getSchedulesForCurrentSlot(
    dayOfWeek: number,
    slotStartHour: number,
    slotStartMinute: number,
  ) {
    const schedules = await this.prisma.callScheduleGroup.findMany({
      where: {
        slotStartHour,
        slotStartMinute,
        weekdays: { has: dayOfWeek },
        isEnabled: true,
        wardId: { not: null },
      },
      include: {
        ward: {
          include: {
            user: { select: { id: true, identity: true } },
          },
        },
      },
    });

    return schedules
      .filter(s => s.ward !== null)
      .map(s => ({
        schedule_id: s.id,
        ward_id: s.wardId!,
        ward_user_id: s.ward!.userId,
        ward_identity: s.ward!.user.identity,
        ai_persona: s.ward!.aiPersona ?? '다미',
      }));
  }

  /**
   * Get upcoming scheduled calls for the dashboard
   * Returns calls scheduled for the next N hours
   */
  async getUpcomingScheduledCalls(hoursAhead: number = 2) {
    const now = new Date();
    const dayOfWeek = now.getDay();
    const currentHour = now.getHours();
    const currentMinute = now.getMinutes();

    // Get all schedules for today that are in the future (within hoursAhead)
    const schedules = await this.prisma.callScheduleGroup.findMany({
      where: {
        weekdays: { has: dayOfWeek },
        isEnabled: true,
        wardId: { not: null },
        OR: [
          // Same hour but later minute
          {
            slotStartHour: currentHour,
            slotStartMinute: { gt: currentMinute },
          },
          // Future hours within range
          {
            slotStartHour: { gt: currentHour, lte: currentHour + hoursAhead },
          },
        ],
      },
      include: {
        ward: {
          include: {
            user: {
              select: {
                id: true,
                identity: true,
                displayName: true,
                nickname: true,
              },
            },
          },
        },
      },
      orderBy: [{ slotStartHour: 'asc' }, { slotStartMinute: 'asc' }],
    });

    return schedules
      .filter(s => s.ward !== null)
      .map(s => ({
        scheduleId: s.id,
        wardId: s.wardId!,
        wardName:
          s.ward!.user.displayName ??
          s.ward!.user.nickname ??
          s.ward!.user.identity,
        wardIdentity: s.ward!.user.identity,
        aiPersona: s.ward!.aiPersona ?? '다미',
        slotStartHour: s.slotStartHour,
        slotStartMinute: s.slotStartMinute,
        scheduledTime: `${String(s.slotStartHour).padStart(2, '0')}:${String(s.slotStartMinute).padStart(2, '0')}`,
      }));
  }

  async listOrganizationBeneficiaries(params: {
    organizationId: string;
    search?: string;
    riskOnly?: boolean;
    page: number;
    pageSize: number;
  }): Promise<BeneficiaryListResult> {
    const { organizationId, search, riskOnly = false, page, pageSize } = params;

    // List all beneficiaries (both registered and pending) for this organization.
    // SECURITY: organizationId check is crucial here.
    const where: Prisma.OrganizationWardWhereInput = {
      organizationId,
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
        age: calculateAge(row.birthDate),
        gender: row.gender ?? null,
        type: row.wardType ?? null,
        address: row.address,
        manager:
          row.uploadedByAdmin?.name ?? row.uploadedByAdmin?.email ?? null,
        status,
        lastCall,
      };
    });

    return { data, total };
  }

  async findOrganizationBeneficiaryForDeletion(params: {
    organizationId: string;
    beneficiaryId: string;
  }): Promise<BeneficiaryDeleteInfo | null> {
    const row = await this.prisma.organizationWard.findFirst({
      where: {
        id: params.beneficiaryId,
        organizationId: params.organizationId,
      },
      select: {
        id: true,
        ward: { select: { userId: true } },
      },
    });

    if (!row) return null;

    return {
      id: row.id,
      ward_user_id: row.ward?.userId ?? null,
    };
  }

  async deleteOrganizationBeneficiary(params: {
    organizationId: string;
    beneficiaryId: string;
  }): Promise<boolean> {
    const result = await this.prisma.organizationWard.deleteMany({
      where: {
        id: params.beneficiaryId,
        organizationId: params.organizationId,
      },
    });
    return result.count > 0;
  }

  async updateOrganizationBeneficiary(params: {
    organizationId: string;
    beneficiaryId: string;
    data: BeneficiaryUpdateInput;
  }): Promise<BeneficiaryDetailItem | null> {
    const existing = await this.prisma.organizationWard.findFirst({
      where: {
        id: params.beneficiaryId,
        organizationId: params.organizationId,
      },
    });
    if (!existing) return null;

    const updateData: Prisma.OrganizationWardUpdateInput = {};
    if (params.data.name !== undefined) {
      updateData.name = params.data.name;
    }
    if (
      params.data.phoneNumber !== undefined &&
      params.data.phoneNumber !== null
    ) {
      updateData.phoneNumber = params.data.phoneNumber;
    }
    if (params.data.birthDate !== undefined) {
      updateData.birthDate = params.data.birthDate
        ? new Date(params.data.birthDate)
        : null;
    }
    if (params.data.address !== undefined)
      updateData.address = params.data.address;
    if (params.data.gender !== undefined)
      updateData.gender = params.data.gender;
    if (params.data.wardType !== undefined)
      updateData.wardType = params.data.wardType;
    // Consolidated fields (previously in detail table)
    if (params.data.guardian !== undefined)
      updateData.emergencyContact = params.data.guardian;
    if (params.data.diseases !== undefined)
      updateData.diseases = params.data.diseases;
    if (params.data.medication !== undefined)
      updateData.medication = params.data.medication;
    if (params.data.notes !== undefined) updateData.notes = params.data.notes;

    if (Object.keys(updateData).length === 0) {
      const existingDetail = await this.prisma.organizationWard.findFirst({
        where: {
          id: existing.id,
          organizationId: params.organizationId,
        },
        include: beneficiaryDetailInclude,
      });

      return existingDetail ? toBeneficiaryDetailItem(existingDetail) : null;
    }

    const updated = await this.prisma.organizationWard.update({
      where: { id: existing.id },
      data: updateData,
      include: beneficiaryDetailInclude,
    });

    return toBeneficiaryDetailItem(updated);
  }

  async getOrganizationBeneficiaryDetail(params: {
    organizationId: string;
    beneficiaryId: string;
  }): Promise<BeneficiaryDetailItem | null> {
    const { organizationId, beneficiaryId } = params;
    const row = await this.prisma.organizationWard.findFirst({
      where: {
        id: beneficiaryId,
        organizationId,
      },
      include: beneficiaryDetailInclude,
    });

    if (!row) return null;

    return toBeneficiaryDetailItem(row);
  }

  /**
   * Get beneficiary call schedule
   * Returns day-wise schedule (each day has 0 or 1 time slot)
   */
  async getBeneficiarySchedule(params: {
    organizationId: string;
    beneficiaryId: string;
  }): Promise<BeneficiaryScheduleData | null> {
    const { organizationId, beneficiaryId } = params;

    // Get organization ward and verify it belongs to the organization
    const orgWard = await this.prisma.organizationWard.findFirst({
      where: {
        id: beneficiaryId,
        organizationId,
      },
      select: {
        wardId: true,
        updatedAt: true,
      },
    });

    if (!orgWard) return null;

    // Initialize empty schedule
    const schedule: BeneficiaryScheduleData['schedule'] = {
      sunday: null,
      monday: null,
      tuesday: null,
      wednesday: null,
      thursday: null,
      friday: null,
      saturday: null,
    };

    // If not linked to a ward, return empty schedule
    if (!orgWard.wardId) {
      return {
        schedule,
        updatedAt: orgWard.updatedAt.toISOString(),
      };
    }

    // Get schedules from CallScheduleGroup for this ward
    const schedules = await this.prisma.callScheduleGroup.findMany({
      where: {
        wardId: orgWard.wardId,
        isEnabled: true,
      },
      orderBy: { updatedAt: 'desc' },
    });

    for (const sched of schedules) {
      // NOTE: slotStartHour/Minute are stored as local (KST) wall clock time
      const timeStr = `${sched.slotStartHour.toString().padStart(2, '0')}:${sched.slotStartMinute.toString().padStart(2, '0')}`;
      for (const dayOfWeek of sched.weekdays) {
        if (dayOfWeek >= 0 && dayOfWeek < 7) {
          const dayName = DAY_NAMES[dayOfWeek];
          // Only set if not already set (first match wins - most recent due to orderBy)
          if (schedule[dayName] === null) {
            schedule[dayName] = timeStr;
          }
        }
      }
    }

    // Find the most recent update time
    const latestUpdate =
      schedules.length > 0
        ? schedules
            .map(s => s.updatedAt)
            .reduce((a, b) => (a > b ? a : b))
            .toISOString()
        : orgWard.updatedAt.toISOString();

    return {
      schedule,
      updatedAt: latestUpdate,
    };
  }

  /**
   * Update beneficiary call schedule
   * Replaces existing schedules with new day-wise schedule
   * Uses transaction to ensure atomicity
   */
  async updateBeneficiarySchedule(params: {
    organizationId: string;
    beneficiaryId: string;
    schedule: Partial<BeneficiaryScheduleData['schedule']>;
  }): Promise<BeneficiaryScheduleData | null> {
    const { organizationId, beneficiaryId, schedule } = params;

    // Get organization ward and verify it belongs to the organization
    const orgWard = await this.prisma.organizationWard.findFirst({
      where: {
        id: beneficiaryId,
        organizationId,
      },
      select: {
        wardId: true,
      },
    });

    if (!orgWard) return null;

    // If not linked to a ward, cannot update schedule
    if (!orgWard.wardId) {
      // Just return empty schedule without error
      return {
        schedule: {
          sunday: null,
          monday: null,
          tuesday: null,
          wednesday: null,
          thursday: null,
          friday: null,
          saturday: null,
        },
        updatedAt: new Date().toISOString(),
      };
    }

    const wardId = orgWard.wardId; // Capture for safe usage

    // Group days by time slot to minimize database records
    const timeSlotDays: Record<string, number[]> = {};

    for (let dayOfWeek = 0; dayOfWeek < 7; dayOfWeek++) {
      const dayName = DAY_NAMES[dayOfWeek];
      const timeValue = schedule[dayName];
      if (timeValue) {
        if (!timeSlotDays[timeValue]) {
          timeSlotDays[timeValue] = [];
        }
        timeSlotDays[timeValue].push(dayOfWeek);
      }
    }

    // Use transaction to ensure delete and create are atomic
    await this.prisma.$transaction(async tx => {
      // 1. Delete ALL existing schedules for this ward
      // This is safe even if timeSlotDays is empty (clearing schedule)
      await tx.callScheduleGroup.deleteMany({
        where: {
          wardId: wardId,
        },
      });

      // 2. Create new schedules - one record per unique time slot
      const now = new Date();
      for (const [timeStr, weekdays] of Object.entries(timeSlotDays)) {
        const [hourStr, minuteStr] = timeStr.split(':');
        const hour = parseInt(hourStr, 10);
        const minute = parseInt(minuteStr, 10);

        await tx.callScheduleGroup.create({
          data: {
            wardId: wardId,
            slotStartHour: hour,
            slotStartMinute: minute,
            weekdays,
            isEnabled: true,
            createdAt: now,
            updatedAt: now,
          },
        });
      }
    });

    // Return updated schedule
    return this.getBeneficiarySchedule({ organizationId, beneficiaryId });
  }
}

function toBeneficiaryDetailItem(
  row: OrganizationWardWithDetail,
): BeneficiaryDetailItem {
  const guardianUser = row.ward?.guardian?.user;
  // Use emergencyContact from consolidatedmodel, fallback to linked ward's guardian
  const guardian = row.emergencyContact ?? formatGuardian(guardianUser);
  const recentLogs =
    row.ward?.callSummaries.map(summary => {
      const createdAt = summary.call?.createdAt ?? summary.createdAt;
      return {
        id: summary.id,
        date: createdAt.toISOString(),
        type: 'AI 안부',
        content: summary.summary ?? '요약 정보 없음',
        sentiment: mapMoodToSentiment(summary.mood),
      };
    }) ?? [];

  return {
    id: row.id,
    name: row.name,
    email: row.email,
    phoneNumber: row.phoneNumber ?? null,
    birthDate: row.birthDate?.toISOString().split('T')[0] ?? null,
    address: row.address ?? null,
    gender: row.gender ?? null,
    type: row.wardType ?? null,
    guardian,
    diseases: row.diseases ?? [],
    medication: row.medication ?? null,
    notes: row.notes ?? null,
    recentLogs,
  };
}

function calculateAge(birthDate: Date | null): number | null {
  if (!birthDate) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - birthDate.getUTCFullYear();
  const monthDiff = today.getUTCMonth() - birthDate.getUTCMonth();
  if (
    monthDiff < 0 ||
    (monthDiff === 0 && today.getUTCDate() < birthDate.getUTCDate())
  ) {
    age -= 1;
  }
  return age;
}

function formatGuardian(user?: {
  displayName: string | null;
  nickname: string | null;
  email: string | null;
}): string | null {
  if (!user) return null;
  const name = user.displayName ?? user.nickname ?? null;
  const email = user.email ?? null;
  if (name && email) return `${name} (${email})`;
  return name ?? email;
}

function mapMoodToSentiment(
  mood?: string | null,
): 'positive' | 'neutral' | 'negative' | undefined {
  if (mood === 'positive' || mood === 'neutral' || mood === 'negative') {
    return mood;
  }
  return undefined;
}

/**
 * Constants for internal repository use
 */
const DAY_NAMES = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
] as const;

/**
 * Beneficiary schedule data structure
 */
export interface BeneficiaryScheduleData {
  schedule: {
    sunday: string | null;
    monday: string | null;
    tuesday: string | null;
    wednesday: string | null;
    thursday: string | null;
    friday: string | null;
    saturday: string | null;
  };
  updatedAt: string;
}
