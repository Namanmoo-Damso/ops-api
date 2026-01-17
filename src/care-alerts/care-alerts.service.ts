import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { EventsService } from '../events/events.service';
import { CreateCareAlertDto } from './dto/create-care-alert.dto';
import {
  CareAlertCreatedResponse,
  CareAlertEventResponse,
  GetAlertsResponse,
  EmotionReportResponse,
  EmotionSummaryResponse,
  AcknowledgeAlertResponse,
} from './dto/care-alert-response.dto';
import {
  AlertType,
  Severity,
  EmotionType,
  EmotionPayload,
  EmotionBufferData,
  EmotionAggregation,
  IMMEDIATE_ALERT_CONDITIONS,
  NEGATIVE_EMOTIONS,
} from './types/care-alert.types';

@Injectable()
export class CareAlertsService {
  private readonly logger = new Logger(CareAlertsService.name);

  // wardId -> EmotionBufferData[] (10분 집계용 버퍼)
  private emotionBuffers: Map<string, EmotionBufferData[]> = new Map();

  // roomName -> current danger code (4-bit string tracking active alerts)
  // Bit positions: 1000=deviceFall, 0100=personFall, 0010=loudVoice, 0001=emotion
  private roomDangerCodes: Map<string, string> = new Map();

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly eventsService: EventsService,
  ) {
    this.logger.log('CareAlertsService initialized');
  }

  /**
   * 케어 알림 처리 메인 로직
   */
  async processAlert(
    wardId: string,
    dto: CreateCareAlertDto,
  ): Promise<CareAlertCreatedResponse> {
    const startTime = Date.now();

    // 상세 로그 - 수신 데이터
    this.logger.log(
      `[CARE_ALERT_RECEIVED] wardId=${wardId} alertType=${dto.alertType} severity=${dto.severity} timestamp=${dto.timestamp}`,
    );
    this.logger.debug(
      `[CARE_ALERT_PAYLOAD] wardId=${wardId} data=${JSON.stringify(dto.data)}`,
    );

    try {
      // Emotion은 버퍼링 (중복 체크 불필요)
      if (dto.alertType === 'emotion') {
        return this.bufferEmotion(wardId, dto);
      }

      // 중복 Alert 체크 (같은 wardId + alertType + timestamp ±1초)
      const alertTime = new Date(dto.timestamp);
      const existingAlert = await this.prisma.careAlertEvent.findFirst({
        where: {
          wardId,
          alertType: dto.alertType,
          timestamp: {
            gte: new Date(alertTime.getTime() - 1000),
            lte: new Date(alertTime.getTime() + 1000),
          },
        },
      });

      if (existingAlert) {
        this.logger.log(
          `[CARE_ALERT_DUPLICATE] wardId=${wardId} alertType=${dto.alertType} existingId=${existingAlert.id}`,
        );
        return {
          success: true,
          alertType: dto.alertType,
          processed: 'duplicate',
          alertId: existingAlert.id,
        };
      }

      // Fall/LoudVoice → 원본 저장 + 즉시 알림
      const event = await this.saveCareAlertEvent(wardId, dto);

      // 즉시 알림 조건 확인
      const shouldNotify = this.shouldSendImmediateNotification(
        dto.alertType,
        dto.severity,
      );

      if (shouldNotify) {
        await this.sendNotifications(wardId, event);
      }

      const elapsed = Date.now() - startTime;
      this.logger.log(
        `[CARE_ALERT_PROCESSED] wardId=${wardId} alertType=${dto.alertType} alertId=${event.id} notified=${shouldNotify} elapsed=${elapsed}ms`,
      );

      return {
        success: true,
        alertType: dto.alertType,
        processed: 'stored',
        alertId: event.id,
      };
    } catch (error) {
      this.logger.error(
        `[CARE_ALERT_ERROR] wardId=${wardId} alertType=${dto.alertType} error=${error instanceof Error ? error.message : String(error)}`,
      );
      throw error;
    }
  }

  /**
   * Emotion 데이터 버퍼링 (10분 집계)
   */
  private bufferEmotion(
    wardId: string,
    dto: CreateCareAlertDto,
  ): CareAlertCreatedResponse {
    const payload = dto.data.payload as unknown as EmotionPayload;

    const bufferData: EmotionBufferData = {
      timestamp: dto.timestamp,
      emotion: payload.emotion,
      confidence: payload.confidence,
      intensity: payload.intensity,
    };

    if (!this.emotionBuffers.has(wardId)) {
      this.emotionBuffers.set(wardId, []);
    }

    const buffer = this.emotionBuffers.get(wardId)!;
    buffer.push(bufferData);

    this.logger.log(
      `[EMOTION_BUFFERED] wardId=${wardId} emotion=${payload.emotion} confidence=${payload.confidence.toFixed(2)} bufferSize=${buffer.length}`,
    );

    return {
      success: true,
      alertType: 'emotion',
      processed: 'buffered',
    };
  }

  /**
   * 10분마다 Emotion 버퍼 플러시 및 집계
   */
  @Cron('0 */10 * * * *')
  async flushEmotionBuffers(): Promise<void> {
    const startTime = Date.now();
    const wardIds = Array.from(this.emotionBuffers.keys());

    if (wardIds.length === 0) {
      return;
    }

    this.logger.log(
      `[EMOTION_FLUSH_START] wardCount=${wardIds.length} totalBuffered=${wardIds.reduce((sum, id) => sum + (this.emotionBuffers.get(id)?.length ?? 0), 0)}`,
    );

    for (const wardId of wardIds) {
      const buffer = this.emotionBuffers.get(wardId);
      if (!buffer || buffer.length === 0) continue;

      try {
        await this.aggregateAndSaveEmotions(wardId, buffer);
        this.emotionBuffers.set(wardId, []); // 버퍼 클리어
      } catch (error) {
        this.logger.error(
          `[EMOTION_FLUSH_ERROR] wardId=${wardId} error=${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    const elapsed = Date.now() - startTime;
    this.logger.log(`[EMOTION_FLUSH_COMPLETE] elapsed=${elapsed}ms`);
  }

  /**
   * Emotion 집계 및 저장
   */
  private async aggregateAndSaveEmotions(
    wardId: string,
    buffer: EmotionBufferData[],
  ): Promise<void> {
    if (buffer.length === 0) return;

    const now = new Date();
    const periodEnd = new Date(
      Math.floor(now.getTime() / (10 * 60 * 1000)) * (10 * 60 * 1000),
    );
    const periodStart = new Date(periodEnd.getTime() - 10 * 60 * 1000);

    // 감정별 카운트
    const emotionCounts: Record<EmotionType, number> = {
      neutral: 0,
      happy: 0,
      sad: 0,
      angry: 0,
      fearful: 0,
      disgusted: 0,
      surprised: 0,
    };

    let totalConfidence = 0;

    for (const data of buffer) {
      emotionCounts[data.emotion]++;
      totalConfidence += data.confidence;
    }

    const totalSamples = buffer.length;

    // 감정 분포 (비율)
    const emotionDistribution: Record<EmotionType, number> = {} as Record<
      EmotionType,
      number
    >;
    for (const [emotion, count] of Object.entries(emotionCounts)) {
      emotionDistribution[emotion as EmotionType] =
        Math.round((count / totalSamples) * 1000) / 1000;
    }

    // 부정적 감정 비율
    const negativeCount = NEGATIVE_EMOTIONS.reduce(
      (sum, emotion) => sum + emotionCounts[emotion],
      0,
    );
    const negativeRatio =
      Math.round((negativeCount / totalSamples) * 1000) / 1000;

    // 평균 confidence
    const averageConfidence =
      Math.round((totalConfidence / totalSamples) * 1000) / 1000;

    // 지배적 감정
    const dominantEmotion = Object.entries(emotionCounts).reduce((a, b) =>
      a[1] > b[1] ? a : b,
    )[0] as EmotionType;

    // DB 저장
    const summary = await this.prisma.emotionSummary.upsert({
      where: {
        wardId_periodStart: {
          wardId,
          periodStart,
        },
      },
      update: {
        totalSamples,
        emotionDistribution,
        averageConfidence,
        negativeRatio,
        dominantEmotion,
      },
      create: {
        wardId,
        periodStart,
        periodEnd,
        totalSamples,
        emotionDistribution,
        averageConfidence,
        negativeRatio,
        dominantEmotion,
      },
    });

    this.logger.log(
      `[EMOTION_AGGREGATED] wardId=${wardId} period=${periodStart.toISOString()}-${periodEnd.toISOString()} samples=${totalSamples} dominant=${dominantEmotion} negativeRatio=${negativeRatio} summaryId=${summary.id}`,
    );
  }

  /**
   * CareAlertEvent 저장
   */
  private async saveCareAlertEvent(
    wardId: string,
    dto: CreateCareAlertDto,
  ): Promise<{
    id: string;
    alertType: string;
    severity: string;
    timestamp: Date;
    rawPayload: unknown;
    roomName: string | null;
  }> {
    // JSON 타입으로 안전하게 변환
    const rawPayload = JSON.parse(JSON.stringify(dto.data));

    const event = await this.prisma.careAlertEvent.create({
      data: {
        wardId,
        alertType: dto.alertType,
        severity: dto.severity,
        timestamp: new Date(dto.timestamp),
        rawPayload,
        // Agent 연동 필드
        callId: dto.callId ?? null,
        roomName: dto.roomName ?? null,
        agentResponse: dto.agentResponse ?? null,
        source: dto.source ?? 'ios',
      },
    });

    this.logger.log(
      `[CARE_ALERT_SAVED] wardId=${wardId} alertId=${event.id} alertType=${dto.alertType} severity=${dto.severity} source=${dto.source ?? 'ios'}`,
    );

    return event;
  }

  /**
   * 즉시 알림 조건 확인
   */
  private shouldSendImmediateNotification(
    alertType: AlertType,
    severity: Severity,
  ): boolean {
    const conditions = IMMEDIATE_ALERT_CONDITIONS[alertType];
    return conditions.includes(severity);
  }

  /**
   * 알림 전송 (APNs + WebSocket)
   */
  private async sendNotifications(
    wardId: string,
    event: {
      id: string;
      alertType: string;
      severity: string;
      timestamp: Date;
      roomName: string | null;
    },
  ): Promise<void> {
    const notifyStart = Date.now();

    // Ward 정보 조회 (Guardian/Organization 관계 포함)
    const ward = await this.prisma.ward.findUnique({
      where: { id: wardId },
      include: {
        user: true,
        guardian: {
          include: {
            user: {
              include: {
                devices: true,
              },
            },
          },
        },
        organization: true,
      },
    });

    if (!ward) {
      this.logger.warn(`[NOTIFY_SKIP] wardId=${wardId} reason=ward_not_found`);
      return;
    }

    const wardName = ward.user.nickname ?? ward.user.displayName ?? '어르신';
    const { title, body } = this.getAlertMessage(event.alertType, wardName);

    // 1. Guardian에게 APNs Push
    if (ward.guardian?.user.devices) {
      const tokens = ward.guardian.user.devices
        .filter(d => d.apnsToken)
        .map(d => ({ token: d.apnsToken!, env: d.env }));

      if (tokens.length > 0) {
        this.logger.log(
          `[NOTIFY_PUSH] wardId=${wardId} guardianId=${ward.guardian.id} tokens=${tokens.length}`,
        );

        await this.pushService.sendPush({
          tokens,
          type: 'alert',
          title,
          body,
          payload: {
            type: 'care_alert',
            alertType: event.alertType,
            alertId: event.id,
            wardId,
            severity: event.severity,
          },
          interruptionLevel:
            event.severity === 'critical' ? 'critical' : 'time-sensitive',
        });
      }
    }

    // 2. Organization에게 WebSocket 이벤트
    if (ward.organization && event.roomName && wardId) {
      // Compute danger code by ORing new alert type with existing state
      // 4-bit string: 1000=deviceFall, 0100=personFall, 0010=loudVoice, 0001=emotion
      const dangerCode = this.computeDangerCode(event.roomName, event.alertType);

      this.logger.log(
        `[NOTIFY_WS] wardId=${wardId} organizationId=${ward.organization.id} roomName=${event.roomName} dangerCode=${dangerCode}`,
      );

      this.eventsService.emit({
        type: 'room-danger',
        roomName: event.roomName,
        isDanger: true,
        name: `${event.alertType}:${wardId}`,
        wardId: wardId || undefined,
        wardName: wardName || undefined,
        alertType: event.alertType,
        dangerCode,
      });
    } else if (!wardId) {
      this.logger.warn(
        `[NOTIFY_SKIP] wardId not available for room-danger event, roomName=${event.roomName}`,
      );
    }

    const elapsed = Date.now() - notifyStart;
    this.logger.log(
      `[NOTIFY_COMPLETE] wardId=${wardId} alertId=${event.id} elapsed=${elapsed}ms`,
    );
  }

  /**
   * Get the bit mask for an alert type
   * Bit positions: 1000=deviceFall, 0100=personFall, 0010=loudVoice, 0001=emotion
   */
  private getAlertTypeBit(alertType: string): number {
    switch (alertType) {
      case 'device_fall':
        return 0b1000;
      case 'person_fall':
        return 0b0100;
      case 'loud_voice':
        return 0b0010;
      case 'emotion':
        return 0b0001;
      default:
        return 0b0000;
    }
  }

  /**
   * Compute danger code by ORing the new alert type with existing state
   * Returns 4-bit string: 1000=deviceFall, 0100=personFall, 0010=loudVoice, 0001=emotion
   */
  private computeDangerCode(roomName: string, alertType: string): string {
    const currentCode = this.roomDangerCodes.get(roomName) || '0000';
    const currentBits = parseInt(currentCode, 2);
    const newBit = this.getAlertTypeBit(alertType);
    const combinedBits = currentBits | newBit;
    const newCode = combinedBits.toString(2).padStart(4, '0');
    this.roomDangerCodes.set(roomName, newCode);
    return newCode;
  }

  /**
   * Clear a specific alert type from the danger code
   */
  clearDangerCode(roomName: string, alertType?: string): string {
    if (!alertType) {
      // Clear all
      this.roomDangerCodes.delete(roomName);
      return '0000';
    }
    const currentCode = this.roomDangerCodes.get(roomName) || '0000';
    const currentBits = parseInt(currentCode, 2);
    const bitToClear = this.getAlertTypeBit(alertType);
    const newBits = currentBits & ~bitToClear;
    const newCode = newBits.toString(2).padStart(4, '0');
    if (newBits === 0) {
      this.roomDangerCodes.delete(roomName);
    } else {
      this.roomDangerCodes.set(roomName, newCode);
    }
    return newCode;
  }

  /**
   * Get current danger code for a room
   */
  getDangerCode(roomName: string): string {
    return this.roomDangerCodes.get(roomName) || '0000';
  }

  /**
   * 알림 메시지 생성
   */
  private getAlertMessage(
    alertType: string,
    wardName: string,
  ): { title: string; body: string } {
    switch (alertType) {
      case 'device_fall':
        return {
          title: '긴급: 기기 낙상 감지',
          body: `${wardName}님의 기기 낙상이 감지되었습니다. 확인해주세요.`,
        };
      case 'person_fall':
        return {
          title: '긴급: 낙상 감지',
          body: `${wardName}님의 낙상이 감지되었습니다. 확인해주세요.`,
        };
      case 'loud_voice':
        return {
          title: '주의: 큰 소리 감지',
          body: `${wardName}님에게서 큰 소리가 감지되었습니다.`,
        };
      default:
        return {
          title: '케어 알림',
          body: `${wardName}님의 상태를 확인해주세요.`,
        };
    }
  }

  /**
   * 알림 목록 조회 (Guardian용)
   */
  async getAlerts(
    wardId: string,
    options: { type?: string; since?: string; limit?: number },
  ): Promise<GetAlertsResponse> {
    this.logger.log(
      `[GET_ALERTS] wardId=${wardId} type=${options.type ?? 'all'} since=${options.since ?? 'none'}`,
    );

    const where: {
      wardId: string;
      alertType?: string;
      timestamp?: { gte: Date };
    } = { wardId };

    if (options.type) {
      where.alertType = options.type;
    }

    if (options.since) {
      where.timestamp = { gte: new Date(options.since) };
    }

    const [alerts, total] = await Promise.all([
      this.prisma.careAlertEvent.findMany({
        where,
        orderBy: { timestamp: 'desc' },
        take: options.limit ?? 50,
      }),
      this.prisma.careAlertEvent.count({ where }),
    ]);

    return {
      alerts: alerts.map(alert => ({
        id: alert.id,
        wardId: alert.wardId,
        alertType: alert.alertType as AlertType,
        severity: alert.severity as Severity,
        timestamp: alert.timestamp.toISOString(),
        rawPayload: alert.rawPayload as Record<string, unknown>,
        acknowledged: alert.acknowledged,
        acknowledgedAt: alert.acknowledgedAt?.toISOString() ?? null,
        acknowledgedBy: alert.acknowledgedBy ?? null,
        createdAt: alert.createdAt.toISOString(),
      })),
      total,
    };
  }

  /**
   * 감정 리포트 조회 (Guardian용)
   */
  async getEmotionReport(
    wardId: string,
    date: string,
  ): Promise<EmotionReportResponse> {
    this.logger.log(`[GET_EMOTION_REPORT] wardId=${wardId} date=${date}`);

    const targetDate = new Date(date);
    const startOfDay = new Date(targetDate.setHours(0, 0, 0, 0));
    const endOfDay = new Date(targetDate.setHours(23, 59, 59, 999));

    const [summaries, alertCount] = await Promise.all([
      this.prisma.emotionSummary.findMany({
        where: {
          wardId,
          periodStart: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
        orderBy: { periodStart: 'asc' },
      }),
      this.prisma.careAlertEvent.count({
        where: {
          wardId,
          timestamp: {
            gte: startOfDay,
            lte: endOfDay,
          },
        },
      }),
    ]);

    // 일별 통계 계산
    let totalSamples = 0;
    let totalNegativeRatio = 0;
    const emotionTotals: Record<EmotionType, number> = {
      neutral: 0,
      happy: 0,
      sad: 0,
      angry: 0,
      fearful: 0,
      disgusted: 0,
      surprised: 0,
    };

    for (const summary of summaries) {
      totalSamples += summary.totalSamples;
      totalNegativeRatio +=
        Number(summary.negativeRatio) * summary.totalSamples;

      const dist = summary.emotionDistribution as Record<EmotionType, number>;
      for (const [emotion, ratio] of Object.entries(dist)) {
        emotionTotals[emotion as EmotionType] += ratio * summary.totalSamples;
      }
    }

    let dominantEmotion: EmotionType | null = null;
    if (totalSamples > 0) {
      dominantEmotion = Object.entries(emotionTotals).reduce((a, b) =>
        a[1] > b[1] ? a : b,
      )[0] as EmotionType;
    }

    return {
      date,
      summaries: summaries.map(s => ({
        id: s.id,
        periodStart: s.periodStart.toISOString(),
        periodEnd: s.periodEnd.toISOString(),
        totalSamples: s.totalSamples,
        emotionDistribution: s.emotionDistribution as Record<
          EmotionType,
          number
        >,
        averageConfidence: Number(s.averageConfidence),
        negativeRatio: Number(s.negativeRatio),
        dominantEmotion: s.dominantEmotion as EmotionType,
      })),
      dailyStats: {
        totalSamples,
        dominantEmotion,
        negativeRatio:
          totalSamples > 0
            ? Math.round((totalNegativeRatio / totalSamples) * 1000) / 1000
            : 0,
        alertCount,
      },
    };
  }

  /**
   * 알림 확인 처리
   */
  async acknowledgeAlert(
    alertId: string,
    userId: string,
  ): Promise<AcknowledgeAlertResponse> {
    this.logger.log(`[ACKNOWLEDGE_ALERT] alertId=${alertId} userId=${userId}`);

    const now = new Date();

    // Internal (Agent) 요청인 경우 acknowledgedBy를 null로 설정 (UUID 타입이므로)
    const acknowledgedBy = userId === 'internal' ? null : userId;

    await this.prisma.careAlertEvent.update({
      where: { id: alertId },
      data: {
        acknowledged: true,
        acknowledgedAt: now,
        acknowledgedBy,
      },
    });

    return {
      success: true,
      alertId,
      acknowledgedAt: now.toISOString(),
    };
  }

  /**
   * 특정 Ward의 버퍼 상태 조회 (디버깅용)
   */
  getBufferStatus(wardId?: string): {
    wardId: string;
    bufferSize: number;
    oldestTimestamp?: number;
    newestTimestamp?: number;
  }[] {
    const result: {
      wardId: string;
      bufferSize: number;
      oldestTimestamp?: number;
      newestTimestamp?: number;
    }[] = [];

    const wards = wardId ? [wardId] : Array.from(this.emotionBuffers.keys());

    for (const id of wards) {
      const buffer = this.emotionBuffers.get(id);
      if (buffer && buffer.length > 0) {
        result.push({
          wardId: id,
          bufferSize: buffer.length,
          oldestTimestamp: buffer[0].timestamp,
          newestTimestamp: buffer[buffer.length - 1].timestamp,
        });
      }
    }

    return result;
  }
}
