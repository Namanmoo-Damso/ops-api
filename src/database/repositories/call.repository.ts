/**
 * Call Repository
 * calls, call_summaries 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { Prisma, IndexingStatus } from '@prisma/client';
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

  async updateState(
    callId: string,
    state: 'answered' | 'ended',
  ): Promise<CallRow | null> {
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

    return summaries.map(s => {
      const duration =
        s.call.answeredAt && s.call.endedAt
          ? Math.round(
              (s.call.endedAt.getTime() - s.call.answeredAt.getTime()) / 60000,
            )
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

    // Collect all ward userIds for batch query
    const wardUserIds = schedules
      .filter(s => s.ward.guardian?.user)
      .map(s => s.ward.userId);

    // Batch query: find all userIds that have recent calls
    const recentCalls =
      wardUserIds.length > 0
        ? await this.prisma.call.groupBy({
            by: ['calleeUserId'],
            where: {
              calleeUserId: { in: wardUserIds },
              state: 'ended',
              createdAt: { gt: cutoff },
            },
          })
        : [];
    const hasRecentCallSet = new Set(recentCalls.map(c => c.calleeUserId));

    const results: Array<{
      ward_id: string;
      ward_identity: string;
      guardian_identity: string;
      guardian_user_id: string;
    }> = [];

    for (const schedule of schedules) {
      if (!schedule.ward.guardian?.user) continue;

      // Check if there's a recent ended call (O(1) lookup)
      if (!hasRecentCallSet.has(schedule.ward.userId)) {
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

  async getContextByRoomName(roomName: string) {
    const call = await this.prisma.call.findFirst({
      where: { roomName },
      orderBy: { createdAt: 'desc' },
      include: {
        callee: {
          include: {
            ward: {
              include: {
                wardCurrentLocation: true,
              },
            },
          },
        },
      },
    });

    if (!call) return undefined;

    const currentLocation = call.callee?.ward?.wardCurrentLocation;

    return {
      call_id: call.callId,
      ward_id: call.callee?.ward?.id ?? null,
      latitude: currentLocation?.latitude?.toString() ?? null,
      longitude: currentLocation?.longitude?.toString() ?? null,
    };
  }

  async getForAnalysis(callId: string) {
    const call = await this.prisma.call.findUnique({
      where: { callId },
      include: {
        caller: {
          include: {
            ward: true,
          },
        },
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

    // Voice Agent 통화: caller가 ward(어르신), callee가 AI agent
    // 일반 통화: callee가 ward(어르신)
    // callerUserId가 없으면 calleeUserId로부터 wardId 조회
    let wardId = call.caller?.ward?.id ?? call.callee?.ward?.id ?? null;

    // If neither caller nor callee has ward info, try to find ward by calleeUserId
    if (!wardId && call.calleeUserId) {
      const ward = await this.prisma.ward.findUnique({
        where: { userId: call.calleeUserId },
        select: { id: true },
      });
      wardId = ward?.id ?? null;
    }

    const guardianId =
      call.caller?.ward?.guardianId ?? call.callee?.ward?.guardianId ?? null;

    return {
      call_id: call.callId,
      callee_user_id: call.calleeUserId,
      ward_id: wardId,
      guardian_id: guardianId,
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
    const dataInput = {
      callId: params.callId,
      summary: params.summary,
      mood: params.mood,
      moodScore: new Prisma.Decimal(params.moodScore),
      tags: params.tags,
      healthKeywords: params.healthKeywords as Prisma.InputJsonValue,
      ...(params.wardId ? { wardId: params.wardId } : {}),
    } as Prisma.CallSummaryUncheckedCreateInput;

    const summary = await this.prisma.callSummary.create({
      data: dataInput,
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

    return summaries.filter(s => {
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

  /**
   * 현재 활성 통화 수 조회 (ended 상태가 아닌 통화)
   */
  async getActiveCallCount(): Promise<number> {
    return this.prisma.call.count({
      where: {
        state: { not: 'ended' },
        endedAt: null,
      },
    });
  }

  /**
   * 특정 사용자가 이미 활성 통화 중인지 확인
   * @param userId 사용자 ID
   * @param excludeRingingRoom 예약 통화 수락 시, 해당 room의 ringing call은 제외
   */
  async hasActiveCall(
    userId: string,
    excludeRingingRoom?: string,
  ): Promise<boolean> {
    // ringing 상태는 "전화벨 울리는 중"이지 "통화 중"이 아니므로
    // answered 상태만 "활성 통화"로 간주
    const count = await this.prisma.call.count({
      where: {
        OR: [{ callerUserId: userId }, { calleeUserId: userId }],
        state: 'answered', // ringing이 아닌 answered만 체크
        endedAt: null,
        // 예약 통화 수락 시, 해당 room의 ringing call은 "중복 통화"로 간주하지 않음
        // (이 로직은 ringing 체크가 아니므로 사실상 불필요하지만, 명시성을 위해 유지)
        NOT: excludeRingingRoom
          ? { roomName: excludeRingingRoom, state: 'ringing' }
          : undefined,
      },
    });
    return count > 0;
  }

  /**
   * RAG 인덱싱 상태 원자적 업데이트
   * 워커에서 인덱싱 작업 시작/완료/실패 시 호출
   *
   * @param callId 통화 ID
   * @param status 새로운 인덱싱 상태
   * @param error 에러 메시지 (실패 시)
   * @param incrementAttempts 재시도 횟수 증가 여부
   */
  async updateIndexingStatus(params: {
    callId: string;
    status: IndexingStatus;
    error?: string | null;
    incrementAttempts?: boolean;
  }): Promise<CallRow | null> {
    const { callId, status, error, incrementAttempts } = params;

    const updateData: Prisma.CallUpdateInput = {
      indexingStatus: status,
      indexingError: error ?? null,
    };

    // 완료 시 indexed_at 타임스탬프 설정
    if (status === IndexingStatus.COMPLETED) {
      updateData.indexedAt = new Date();
    }

    // 재시도 횟수 증가 (PROCESSING 시작 시)
    if (incrementAttempts) {
      updateData.indexingAttempts = { increment: 1 };
    }

    try {
      const call = await this.prisma.call.update({
        where: { callId },
        data: updateData,
      });
      return call ? toCallRow(call) : null;
    } catch {
      return null;
    }
  }

  /**
   * 실패한 인덱싱 작업 조회 (재시도 대상)
   * 최대 재시도 횟수 미만인 FAILED 상태 통화만 반환
   *
   * @param maxAttempts 최대 재시도 횟수
   * @param limit 조회 개수
   */
  async getFailedIndexingCalls(
    maxAttempts: number = 3,
    limit: number = 100,
  ): Promise<
    Array<{ callId: string; wardId: string | null; attempts: number }>
  > {
    const calls = await this.prisma.call.findMany({
      where: {
        indexingStatus: IndexingStatus.FAILED,
        indexingAttempts: { lt: maxAttempts },
      },
      select: {
        callId: true,
        indexingAttempts: true,
        callee: {
          select: {
            ward: {
              select: { id: true },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });

    return calls.map(c => ({
      callId: c.callId,
      wardId: c.callee?.ward?.id ?? null,
      attempts: c.indexingAttempts,
    }));
  }

  /**
   * 특정 통화의 인덱싱 정보 조회
   */
  async getIndexingInfo(callId: string): Promise<{
    callId: string;
    status: IndexingStatus;
    error: string | null;
    attempts: number;
    indexedAt: Date | null;
  } | null> {
    const call = await this.prisma.call.findUnique({
      where: { callId },
      select: {
        callId: true,
        indexingStatus: true,
        indexingError: true,
        indexingAttempts: true,
        indexedAt: true,
      },
    });

    if (!call) return null;

    return {
      callId: call.callId,
      status: call.indexingStatus,
      error: call.indexingError,
      attempts: call.indexingAttempts,
      indexedAt: call.indexedAt,
    };
  }

  /**
   * Stale call 정리: 'answered' 상태에서 maxAgeMinutes 이상 지속된 통화를 'ended'로 변경
   * LiveKit webhook 누락 시 안전망 역할
   *
   * @param maxAgeMinutes 스테일로 간주할 최소 시간 (분)
   * @returns 종료된 통화 ID 목록
   */
  async endStaleCalls(
    maxAgeMinutes: number = 15,
  ): Promise<{ count: number; callIds: string[] }> {
    const cutoff = new Date(Date.now() - maxAgeMinutes * 60 * 1000);

    // 먼저 대상 통화 조회 (로깅 및 감사용)
    const staleCalls = await this.prisma.call.findMany({
      where: {
        state: 'answered',
        endedAt: null,
        // answeredAt이 null일 수 있으므로 createdAt 기반 OR 조건 추가
        OR: [{ answeredAt: { lt: cutoff } }, { createdAt: { lt: cutoff } }],
      },
      select: { callId: true },
    });

    if (staleCalls.length === 0) {
      return { count: 0, callIds: [] };
    }

    const callIds = staleCalls.map(c => c.callId);

    // 조회된 callId 기준으로 업데이트 (race condition 방지)
    await this.prisma.call.updateMany({
      where: {
        callId: { in: callIds },
        state: 'answered', // 상태 재확인
        endedAt: null,
      },
      data: {
        state: 'ended',
        endedAt: new Date(),
      },
    });

    return { count: callIds.length, callIds };
  }

  /**
   * roomName으로 처리되지 않은 모든 통화를 종료
   * room_finished 웹훅에서 callContext를 찾지 못했을 때 fallback으로 사용
   *
   * @returns 종료된 통화 ID 목록
   */
  async endCallsByRoomName(
    roomName: string,
  ): Promise<{ count: number; callIds: string[] }> {
    // 먼저 대상 통화 조회 (로깅용)
    const activeCalls = await this.prisma.call.findMany({
      where: {
        roomName,
        state: { in: ['ringing', 'answered'] }, // 명시적 상태 리스트
        endedAt: null,
      },
      select: { callId: true },
    });

    if (activeCalls.length === 0) {
      return { count: 0, callIds: [] };
    }

    const callIds = activeCalls.map(c => c.callId);

    // 조회된 callId 기준으로 업데이트 (race condition 방지)
    await this.prisma.call.updateMany({
      where: {
        callId: { in: callIds },
        state: { in: ['ringing', 'answered'] }, // 상태 재확인
        endedAt: null,
      },
      data: {
        state: 'ended',
        endedAt: new Date(),
      },
    });

    return { count: callIds.length, callIds };
  }
}
