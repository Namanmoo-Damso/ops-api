/**
 * Call Repository
 * calls, call_summaries 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { Prisma } from '../../generated/prisma';
import { CallRow, CallSummaryRow } from '../types';
import { toCallRow, toCallSummaryRow } from '../prisma-mappers';

@Injectable()
export class CallRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findRinging(
    calleeIdentity: string,
    roomName: string,
    seconds: number,
  ): Promise<{ callId: string } | null> {
    const cutoff = new Date(Date.now() - seconds * 1000);
    const call = await this.prisma.call.findFirst({
      where: {
        calleeIdentity,
        roomName,
        state: 'ringing',
        createdAt: { gt: cutoff },
      },
      select: { callId: true },
    });
    return call;
  }

  async create(params: {
    callerIdentity: string;
    calleeIdentity: string;
    callerUserId?: string;
    calleeUserId?: string;
    roomName: string;
  }): Promise<CallRow> {
    const call = await this.prisma.call.create({
      data: {
        callerUserId: params.callerUserId ?? null,
        calleeUserId: params.calleeUserId ?? null,
        callerIdentity: params.callerIdentity,
        calleeIdentity: params.calleeIdentity,
        roomName: params.roomName,
        state: 'ringing',
      },
    });
    return toCallRow(call);
  }

  async updateState(callId: string, state: 'answered' | 'ended'): Promise<CallRow | null> {
    const data: Prisma.CallUpdateInput =
      state === 'answered'
        ? { state, answeredAt: new Date() }
        : { state, endedAt: new Date() };

    const call = await this.prisma.call.update({
      where: { callId },
      data,
    });
    return call ? toCallRow(call) : null;
  }

  async getRecentSummaries(wardId: string, limit: number = 5) {
    const summaries = await this.prisma.callSummary.findMany({
      where: { wardId },
      include: {
        call: {
          select: {
            answeredAt: true,
            endedAt: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return summaries.map((s) => {
      const duration =
        s.call.answeredAt && s.call.endedAt
          ? Math.round((s.call.endedAt.getTime() - s.call.answeredAt.getTime()) / 60000)
          : 0;
      return {
        id: s.id,
        date: s.createdAt.toISOString(),
        duration,
        summary: s.summary || '',
        tags: s.tags || [],
        mood: s.mood || 'neutral',
      };
    });
  }

  async getSummariesForReport(wardId: string, days: number) {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return this.prisma.callSummary.findMany({
      where: {
        wardId,
        createdAt: { gte: cutoff },
      },
      select: {
        summary: true,
        mood: true,
        healthKeywords: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getMissed(hoursAgo: number = 1) {
    const cutoff = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
    const now = new Date();
    const checkTime = new Date(now.getTime() - hoursAgo * 60 * 60 * 1000);
    const dayOfWeek = checkTime.getDay();

    const schedules = await this.prisma.callSchedule.findMany({
      where: {
        dayOfWeek,
        isActive: true,
        lastCalledAt: { lt: cutoff },
      },
      include: {
        ward: {
          include: {
            user: true,
            guardian: {
              include: {
                user: true,
              },
            },
          },
        },
      },
    });

    const results: Array<{
      ward_id: string;
      ward_identity: string;
      guardian_identity: string;
      guardian_user_id: string;
    }> = [];

    for (const schedule of schedules) {
      if (!schedule.ward.guardian?.user) continue;

      // Check if there's a recent ended call
      const recentCall = await this.prisma.call.findFirst({
        where: {
          calleeUserId: schedule.ward.userId,
          state: 'ended',
          createdAt: { gt: cutoff },
        },
      });

      if (!recentCall) {
        results.push({
          ward_id: schedule.ward.id,
          ward_identity: schedule.ward.user.identity,
          guardian_identity: schedule.ward.guardian.user.identity,
          guardian_user_id: schedule.ward.guardian.userId,
        });
      }
    }

    return results;
  }

  async getWithWardInfo(callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { callId },
      include: {
        callee: {
          include: {
            ward: {
              include: {
                guardian: {
                  include: {
                    user: true,
                  },
                },
              },
            },
          },
        },
      },
    });

    if (!call) return undefined;

    return {
      call_id: call.callId,
      callee_user_id: call.calleeUserId,
      callee_identity: call.calleeIdentity,
      ward_id: call.callee?.ward?.id ?? null,
      ward_ai_persona: call.callee?.ward?.aiPersona ?? null,
      guardian_id: call.callee?.ward?.guardianId ?? null,
      guardian_user_id: call.callee?.ward?.guardian?.userId ?? null,
      guardian_identity: call.callee?.ward?.guardian?.user?.identity ?? null,
    };
  }

  async getForAnalysis(callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { callId },
      include: {
        callee: {
          include: {
            ward: true,
          },
        },
      },
    });

    if (!call) return undefined;

    const duration =
      call.answeredAt && call.endedAt
        ? (call.endedAt.getTime() - call.answeredAt.getTime()) / 60000
        : null;

    return {
      call_id: call.callId,
      callee_user_id: call.calleeUserId,
      ward_id: call.callee?.ward?.id ?? null,
      guardian_id: call.callee?.ward?.guardianId ?? null,
      duration,
      transcript: null as string | null,
    };
  }

  async createSummary(params: {
    callId: string;
    wardId: string | null;
    summary: string;
    mood: string;
    moodScore: number;
    tags: string[];
    healthKeywords: Record<string, unknown>;
  }): Promise<CallSummaryRow> {
    const summary = await this.prisma.callSummary.create({
      data: {
        callId: params.callId,
        wardId: params.wardId!,
        summary: params.summary,
        mood: params.mood,
        moodScore: new Prisma.Decimal(params.moodScore),
        tags: params.tags,
        healthKeywords: params.healthKeywords as Prisma.InputJsonValue,
      },
    });
    return toCallSummaryRow(summary);
  }

  async getRecentPainMentions(wardId: string, days: number): Promise<number> {
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    const summaries = await this.prisma.callSummary.findMany({
      where: {
        wardId,
        createdAt: { gt: cutoff },
      },
      select: { healthKeywords: true },
    });

    return summaries.filter((s) => {
      const keywords = s.healthKeywords as Record<string, unknown> | null;
      return keywords && typeof keywords.pain === 'number' && keywords.pain > 0;
    }).length;
  }

  async getSummary(callId: string): Promise<CallSummaryRow | null> {
    const summary = await this.prisma.callSummary.findFirst({
      where: { callId },
      orderBy: { createdAt: 'desc' },
    });
    return summary ? toCallSummaryRow(summary) : null;
  }
}
