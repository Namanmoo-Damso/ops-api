import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PushService } from '../push/push.service';
import { EventsService } from '../events/events.service';
import { LiveKitService } from '../integration/livekit/livekit.service';
import { CreateCareAlertDto } from './dto/create-care-alert.dto';
import {
  CareAlertCreatedResponse,
  CareAlertEventResponse,
  GetAlertsResponse,
  EmotionReportResponse,
  EmotionSummaryResponse,
  AcknowledgeAlertResponse,
  AcknowledgeAllAlertsResponse,
  EscalateAlertResponse,
  RiskLevel,
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

  constructor(
    private readonly prisma: PrismaService,
    private readonly pushService: PushService,
    private readonly eventsService: EventsService,
    private readonly livekitService: LiveKitService,
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
      } else if (dto.riskLevel && dto.riskLevel !== 'normal' && event.roomName) {
        // 즉시 알림은 아니지만 riskLevel이 caution/critical이면 room metadata만 업데이트
        // 이를 통해 Web에서 테두리 색상이 변경됨
        await this.updateRoomMetadataOnly(wardId, event);
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
      `[EMOTION_BUFFERED] wardId=${wardId} emotion=${payload.emotion ?? 'speech_keyword'} confidence=${payload.confidence?.toFixed(2) ?? 'N/A'} bufferSize=${buffer.length}`,
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
    riskLevel: string | null;
    riskScore: Prisma.Decimal | null;
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
        // Risk 분석 필드
        riskLevel: dto.riskLevel ?? null,
        riskScore: dto.riskScore ?? null,
      },
    });

    this.logger.log(
      `[CARE_ALERT_SAVED] wardId=${wardId} alertId=${event.id} alertType=${dto.alertType} severity=${dto.severity} source=${dto.source ?? 'ios'} riskLevel=${dto.riskLevel ?? 'null'} riskScore=${dto.riskScore ?? 'null'}`,
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
   * Room metadata만 업데이트 (푸시 알림 없이 테두리 색상 변경용)
   * riskLevel이 caution/critical이지만 즉시 알림 조건을 만족하지 않을 때 사용
   */
  private async updateRoomMetadataOnly(
    wardId: string,
    event: {
      id: string;
      alertType: string;
      roomName: string | null;
      riskLevel: string | null;
    },
  ): Promise<void> {
    if (!event.roomName) return;

    const dangerCode = this.getDangerCode(event.alertType);
    const riskLevel = event.riskLevel ?? 'caution';

    // Update LiveKit room metadata for real-time sync
    try {
      await this.livekitService.updateRoomMetadata(
        event.roomName,
        JSON.stringify({
          isDanger: true,
          riskLevel,
          dangerCode,
          alertType: event.alertType,
          wardId,
          timestamp: Date.now(),
        }),
      );
      this.logger.log(
        `[METADATA_ONLY] Updated room metadata: room=${event.roomName} dangerCode=${dangerCode} riskLevel=${riskLevel}`,
      );
    } catch (err) {
      this.logger.warn(
        `[METADATA_ONLY] Failed to update room metadata: ${(err as Error).message}`,
      );
    }

    // SSE event for Web dashboard
    this.eventsService.emit({
      type: 'room-danger',
      roomName: event.roomName,
      isDanger: true,
      riskLevel: riskLevel as 'normal' | 'caution' | 'critical',
      name: `${event.alertType}:${wardId}`,
      wardId: wardId || undefined,
      alertType: event.alertType,
    });
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
      riskLevel: string | null;
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

    // 1. Guardian에게 APNs Push (Ward는 DataChannel로 직접 알림)
    if (ward.guardian?.user.devices) {
      const guardianTokens = ward.guardian.user.devices
        .filter(d => d.apnsToken)
        .map(d => ({ token: d.apnsToken!, env: d.env }));

      if (guardianTokens.length > 0) {
        this.logger.log(
          `[NOTIFY_PUSH_GUARDIAN] wardId=${wardId} guardianId=${ward.guardian.id} tokens=${guardianTokens.length}`,
        );

        await this.pushService.sendPush({
          tokens: guardianTokens,
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

    // 3. Organization에게 WebSocket 이벤트 + LiveKit room metadata 업데이트
    if (ward.organization && event.roomName && wardId) {
      this.logger.log(
        `[NOTIFY_WS] wardId=${wardId} organizationId=${ward.organization.id} roomName=${event.roomName}`,
      );

      // Compute danger code based on alert type
      const dangerCode = this.getDangerCode(event.alertType);

      // riskLevel: caution (yellow) or critical (red)
      const riskLevel = event.riskLevel ?? 'critical'; // Default to critical for backward compatibility

      // Update LiveKit room metadata for real-time sync
      try {
        await this.livekitService.updateRoomMetadata(
          event.roomName,
          JSON.stringify({
            isDanger: true, // Keep true for grid border highlight
            riskLevel, // caution or critical - Web uses this for color
            dangerCode,
            alertType: event.alertType,
            wardId,
            timestamp: Date.now(),
          }),
        );
        this.logger.log(
          `[NOTIFY_LIVEKIT] Updated room metadata: room=${event.roomName} dangerCode=${dangerCode} riskLevel=${riskLevel}`,
        );
      } catch (err) {
        this.logger.warn(
          `[NOTIFY_LIVEKIT] Failed to update room metadata: ${(err as Error).message}`,
        );
      }

      this.eventsService.emit({
        type: 'room-danger',
        roomName: event.roomName,
        isDanger: true,
        riskLevel: riskLevel as 'normal' | 'caution' | 'critical',
        name: `${event.alertType}:${wardId}`,
        wardId: wardId || undefined,
        wardName: wardName || undefined,
        alertType: event.alertType,
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
   * Get danger code based on alert type
   * 4-bit string: 1000=deviceFall, 0100=personFall, 0010=loudVoice, 0001=emotion
   */
  private getDangerCode(alertType: string): string {
    switch (alertType) {
      case 'device_fall':
        return '1000';
      case 'person_fall':
        return '0100';
      case 'loud_voice':
        return '0010';
      case 'emotion':
      case 'speech_keyword': // 발화 키워드는 emotion과 동일한 코드
        return '0001';
      default:
        return '0000';
    }
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
      case 'speech_keyword':
        return {
          title: '주의: 위험 발화 감지',
          body: `${wardName}님에게서 도움 요청 발화가 감지되었습니다.`,
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
        // Risk 분석 필드
        riskLevel: (alert.riskLevel as 'normal' | 'caution' | 'critical') ?? null,
        riskScore: alert.riskScore ? Number(alert.riskScore) : null,
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
   * 알림 확인 처리 (개별 해제)
   * 해제 후 같은 roomName의 미해제 alert을 확인하여
   * - 남은 alert이 있으면 가장 높은 riskLevel로 room metadata 유지
   * - 남은 alert이 없으면 isDanger: false로 변경
   */
  async acknowledgeAlert(
    alertId: string,
    userId: string,
  ): Promise<AcknowledgeAlertResponse & { roomMetadataAction: 'clear' | 'update' | 'none'; highestRiskLevel?: RiskLevel }> {
    this.logger.log(`[ACKNOWLEDGE_ALERT] alertId=${alertId} userId=${userId}`);

    const now = new Date();

    // Internal (Agent) 요청인 경우 acknowledgedBy를 null로 설정 (UUID 타입이므로)
    const acknowledgedBy = userId === 'internal' ? null : userId;

    // 먼저 alert 정보 조회 (roomName 필요)
    const alert = await this.prisma.careAlertEvent.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    // 해제 처리
    await this.prisma.careAlertEvent.update({
      where: { id: alertId },
      data: {
        acknowledged: true,
        acknowledgedAt: now,
        acknowledgedBy,
      },
    });

    // roomName이 없으면 room metadata 업데이트 불필요
    if (!alert.roomName) {
      return {
        success: true,
        alertId,
        acknowledgedAt: now.toISOString(),
        roomMetadataAction: 'none',
      };
    }

    // 같은 roomName의 미해제 alert 조회
    const remainingAlerts = await this.prisma.careAlertEvent.findMany({
      where: {
        roomName: alert.roomName,
        acknowledged: false,
        id: { not: alertId }, // 방금 해제한 것 제외
      },
      orderBy: { timestamp: 'desc' },
    });

    this.logger.log(
      `[ACKNOWLEDGE_ALERT] roomName=${alert.roomName} remainingAlerts=${remainingAlerts.length}`,
    );

    if (remainingAlerts.length === 0) {
      // 남은 alert이 없으면 isDanger: false
      return {
        success: true,
        alertId,
        acknowledgedAt: now.toISOString(),
        roomMetadataAction: 'clear',
      };
    }

    // 남은 alert 중 가장 높은 riskLevel 찾기 (critical > caution > normal)
    const riskPriority: Record<string, number> = {
      critical: 3,
      caution: 2,
      normal: 1,
    };

    let highestRisk: RiskLevel = 'normal';
    let highestAlertType = remainingAlerts[0].alertType;

    for (const remainingAlert of remainingAlerts) {
      const risk = (remainingAlert.riskLevel as RiskLevel) ?? 'critical'; // null인 경우 critical로 간주
      if (riskPriority[risk] > riskPriority[highestRisk]) {
        highestRisk = risk;
        highestAlertType = remainingAlert.alertType;
      }
    }

    this.logger.log(
      `[ACKNOWLEDGE_ALERT] roomName=${alert.roomName} highestRiskLevel=${highestRisk} alertType=${highestAlertType}`,
    );

    return {
      success: true,
      alertId,
      acknowledgedAt: now.toISOString(),
      roomMetadataAction: 'update',
      highestRiskLevel: highestRisk,
    };
  }

  /**
   * AlertType별 해제 처리
   * 해당 roomName의 특정 alertType alert만 해제
   * sensor 매핑: emotion → emotion/speech_keyword, audio → loud_voice, motion → device_fall, face → person_fall
   */
  async acknowledgeAlertByType(
    roomName: string,
    sensorType: string,
    userId: string,
  ): Promise<AcknowledgeAllAlertsResponse & { roomMetadataAction: 'clear' | 'update' | 'none'; highestRiskLevel?: RiskLevel }> {
    this.logger.log(`[ACKNOWLEDGE_BY_TYPE] roomName=${roomName} sensorType=${sensorType} userId=${userId}`);

    // sensor → alertType 매핑
    const sensorToAlertTypes: Record<string, string[]> = {
      emotion: ['emotion', 'speech_keyword'],
      audio: ['loud_voice'],
      motion: ['device_fall'],
      face: ['person_fall'],
    };

    const alertTypes = sensorToAlertTypes[sensorType];
    if (!alertTypes) {
      this.logger.warn(`[ACKNOWLEDGE_BY_TYPE] Unknown sensorType=${sensorType}`);
      return {
        success: false,
        acknowledgedCount: 0,
        roomMetadataAction: 'none',
      };
    }

    const now = new Date();
    const acknowledgedBy = userId === 'internal' ? null : userId;

    // 해당 roomName + alertType의 미해제 alert 일괄 해제
    const result = await this.prisma.careAlertEvent.updateMany({
      where: {
        roomName,
        alertType: { in: alertTypes },
        acknowledged: false,
      },
      data: {
        acknowledged: true,
        acknowledgedAt: now,
        acknowledgedBy,
      },
    });

    this.logger.log(
      `[ACKNOWLEDGE_BY_TYPE] roomName=${roomName} alertTypes=${alertTypes.join(',')} acknowledgedCount=${result.count}`,
    );

    // 남은 미해제 alert 확인
    const remainingAlerts = await this.prisma.careAlertEvent.findMany({
      where: {
        roomName,
        acknowledged: false,
      },
      orderBy: { timestamp: 'desc' },
    });

    if (remainingAlerts.length === 0) {
      return {
        success: true,
        acknowledgedCount: result.count,
        roomMetadataAction: 'clear',
      };
    }

    // 남은 alert 중 가장 높은 riskLevel 찾기
    const riskPriority: Record<string, number> = {
      critical: 3,
      caution: 2,
      normal: 1,
    };

    let highestRisk: RiskLevel = 'normal';

    for (const remainingAlert of remainingAlerts) {
      const risk = (remainingAlert.riskLevel as RiskLevel) ?? 'critical';
      if (riskPriority[risk] > riskPriority[highestRisk]) {
        highestRisk = risk;
      }
    }

    return {
      success: true,
      acknowledgedCount: result.count,
      roomMetadataAction: 'update',
      highestRiskLevel: highestRisk,
    };
  }

  /**
   * 전체 해제 처리
   * 해당 roomName의 모든 미해제 alert을 일괄 해제
   */
  async acknowledgeAllAlerts(
    roomName: string,
    userId: string,
  ): Promise<AcknowledgeAllAlertsResponse> {
    this.logger.log(`[ACKNOWLEDGE_ALL_ALERTS] roomName=${roomName} userId=${userId}`);

    const now = new Date();
    const acknowledgedBy = userId === 'internal' ? null : userId;

    // 해당 roomName의 모든 미해제 alert 일괄 해제
    const result = await this.prisma.careAlertEvent.updateMany({
      where: {
        roomName,
        acknowledged: false,
      },
      data: {
        acknowledged: true,
        acknowledgedAt: now,
        acknowledgedBy,
      },
    });

    this.logger.log(
      `[ACKNOWLEDGE_ALL_ALERTS] roomName=${roomName} acknowledgedCount=${result.count}`,
    );

    return {
      success: true,
      acknowledgedCount: result.count,
    };
  }

  /**
   * 알림 격상 처리 (caution → critical)
   */
  async escalateAlert(
    alertId: string,
  ): Promise<EscalateAlertResponse & { roomName: string | null; wardId: string; alertType: string }> {
    this.logger.log(`[ESCALATE_ALERT] alertId=${alertId}`);

    // alert 조회
    const alert = await this.prisma.careAlertEvent.findUnique({
      where: { id: alertId },
    });

    if (!alert) {
      throw new Error(`Alert not found: ${alertId}`);
    }

    // caution인 경우에만 격상 가능
    if (alert.riskLevel !== 'caution') {
      this.logger.warn(
        `[ESCALATE_ALERT] Cannot escalate alertId=${alertId} currentRiskLevel=${alert.riskLevel}`,
      );
      throw new Error(`Cannot escalate alert: current riskLevel is ${alert.riskLevel}, expected caution`);
    }

    // riskLevel을 critical로 업데이트
    await this.prisma.careAlertEvent.update({
      where: { id: alertId },
      data: {
        riskLevel: 'critical',
      },
    });

    this.logger.log(
      `[ESCALATE_ALERT] alertId=${alertId} escalated from caution to critical`,
    );

    return {
      success: true,
      alertId,
      newRiskLevel: 'critical',
      escalatedFromCaution: true,
      roomName: alert.roomName,
      wardId: alert.wardId,
      alertType: alert.alertType,
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
