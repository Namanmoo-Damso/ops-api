import { AlertType, Severity, EmotionType } from '../types/care-alert.types';

// 알림 생성 응답
export interface CareAlertCreatedResponse {
  success: boolean;
  alertType: AlertType;
  processed: 'buffered' | 'stored' | 'duplicate';
  alertId?: string;
}

// Risk 레벨 타입 정의
export type RiskLevel = 'normal' | 'caution' | 'critical';

// 알림 목록 조회 응답
export interface CareAlertEventResponse {
  id: string;
  wardId: string;
  alertType: AlertType;
  severity: Severity;
  timestamp: string;
  rawPayload: Record<string, unknown>;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
  // Risk 분석 필드
  riskLevel: RiskLevel | null;
  riskScore: number | null;
}

export interface GetAlertsResponse {
  alerts: CareAlertEventResponse[];
  total: number;
}

// 감정 리포트 응답
export interface EmotionSummaryResponse {
  id: string;
  periodStart: string;
  periodEnd: string;
  totalSamples: number;
  emotionDistribution: Record<EmotionType, number>;
  averageConfidence: number;
  negativeRatio: number;
  dominantEmotion: EmotionType;
}

export interface EmotionReportResponse {
  date: string;
  summaries: EmotionSummaryResponse[];
  dailyStats: {
    totalSamples: number;
    dominantEmotion: EmotionType | null;
    negativeRatio: number;
    alertCount: number;
  };
}

// 알림 확인 응답
export interface AcknowledgeAlertResponse {
  success: boolean;
  alertId: string;
  acknowledgedAt: string;
}

// 전체 해제 응답
export interface AcknowledgeAllAlertsResponse {
  success: boolean;
  acknowledgedCount: number;
}

// 격상 응답
export interface EscalateAlertResponse {
  success: boolean;
  alertId: string;
  newRiskLevel: 'critical';
  escalatedFromCaution: boolean;
}
