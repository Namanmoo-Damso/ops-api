/**
 * Care Alert Types
 * iOS 앱에서 전송되는 케어 알림 타입 정의
 */

export type AlertType = 'emotion' | 'device_fall' | 'person_fall' | 'loud_voice';
export type Severity = 'low' | 'medium' | 'high' | 'critical';
export type EmotionType =
  | 'neutral'
  | 'happy'
  | 'sad'
  | 'angry'
  | 'fearful'
  | 'disgusted'
  | 'surprised';

export type FallType =
  | 'freefall_impact'
  | 'impact'
  | 'rotation_impact'
  | 'combination';

export type PersonFallDetectionType =
  | 'rapid_descent'
  | 'face_disappeared'
  | 'size_change';

export type LoudVoiceCause = 'scream' | 'loud_speech' | 'unknown';

// Emotion 페이로드
export interface EmotionPayload {
  emotion: EmotionType;
  confidence: number;
  intensity?: number;
  previousEmotion?: EmotionType;
  analysisInterval: number;
}

// Device Fall 페이로드
export interface DeviceFallPayload {
  impactMagnitude: number;
  fallType: FallType;
  freefallDuration?: number;
  maxRotationRate?: number;
}

// Person Fall 페이로드
export interface PersonFallPayload {
  detectionType: PersonFallDetectionType;
  faceYDelta?: number;
  deltaTime?: number;
  lastFacePosition?: {
    x: number;
    y: number;
  };
}

// Loud Voice 페이로드
export interface LoudVoicePayload {
  level: number;
  decibel: number;
  duration: number;
  possibleCause?: LoudVoiceCause;
}

// 공통 Wrapper
export interface CareAlertPayload {
  timestamp: number; // Unix milliseconds
  alertType: AlertType;
  severity: Severity;
  data: {
    type: string;
    payload: EmotionPayload | DeviceFallPayload | PersonFallPayload | LoudVoicePayload;
  };
}

// Emotion 버퍼 데이터 (집계용)
export interface EmotionBufferData {
  timestamp: number;
  emotion: EmotionType;
  confidence: number;
  intensity?: number;
}

// Emotion 집계 결과
export interface EmotionAggregation {
  wardId: string;
  periodStart: Date;
  periodEnd: Date;
  totalSamples: number;
  emotionDistribution: Record<EmotionType, number>;
  averageConfidence: number;
  negativeRatio: number;
  dominantEmotion: EmotionType;
}

// 즉시 알림 조건
export const IMMEDIATE_ALERT_CONDITIONS: Record<AlertType, Severity[]> = {
  emotion: [], // 즉시 알림 안함
  device_fall: ['critical', 'high'],
  person_fall: ['critical'],
  loud_voice: ['critical', 'high'],
};

// 부정적 감정 목록
export const NEGATIVE_EMOTIONS: EmotionType[] = ['sad', 'angry', 'fearful', 'disgusted'];
