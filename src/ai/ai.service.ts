import { Injectable, Logger, Inject } from '@nestjs/common';
import { DbService } from '../database';
import { AI_PROVIDER } from './ai.module';
import type { AiAnalysisProvider } from './ai.interface';
import { CallAnalysisResult, AnalyzeCallResult } from './types';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly dbService: DbService,
    @Inject(AI_PROVIDER) private readonly aiProvider: AiAnalysisProvider,
  ) {}

  async analyzeCall(callId: string): Promise<AnalyzeCallResult> {
    this.logger.log(`analyzeCall callId=${callId}`);

    // 1. 통화 정보 가져오기
    const callInfo = await this.dbService.getCallForAnalysis(callId);
    if (!callInfo) {
      throw new Error(`Call not found: ${callId}`);
    }

    // 2. AI 분석 (또는 Mock)
    const analysis = await this.aiProvider.analyze(callInfo.transcript || '');

    // 3. call_summaries 저장
    const summary = await this.dbService.createCallSummary({
      callId,
      wardId: callInfo.ward_id,
      summary: analysis.summary,
      mood: analysis.mood,
      moodScore: analysis.moodScore,
      tags: analysis.tags,
      healthKeywords: analysis.healthKeywords,
    });

    // 4. 건강 알림 체크 및 생성
    if (callInfo.ward_id && callInfo.guardian_id) {
      await this.checkHealthAlerts(
        callInfo.ward_id,
        callInfo.guardian_id,
        analysis,
      );
    }

    this.logger.log(
      `analyzeCall completed callId=${callId} mood=${analysis.mood}`,
    );

    return {
      callId,
      wardId: callInfo.ward_id,
      summary: analysis.summary,
      mood: analysis.mood,
      moodScore: analysis.moodScore,
      tags: analysis.tags,
      healthKeywords: analysis.healthKeywords,
      duration: callInfo.duration,
      createdAt: summary.analyzed_at,
    };
  }

  private async checkHealthAlerts(
    wardId: string,
    guardianId: string,
    analysis: CallAnalysisResult,
  ) {
    // 통증 관련 체크
    if (analysis.healthKeywords.pain && analysis.healthKeywords.pain > 0) {
      // 최근 3일 통증 언급 횟수 확인
      const recentPainCount = await this.dbService.getRecentPainMentions(
        wardId,
        3,
      );
      if (recentPainCount >= 2) {
        await this.dbService.createHealthAlert({
          wardId,
          guardianId,
          alertType: 'warning',
          message: `${recentPainCount + 1}일 연속 통증 관련 단어가 감지되었습니다`,
        });
        this.logger.log(
          `Health alert created wardId=${wardId} type=pain count=${recentPainCount + 1}`,
        );
      }
    }

    // 부정적 감정 체크
    if (analysis.mood === 'negative' && analysis.moodScore < 0.3) {
      await this.dbService.createHealthAlert({
        wardId,
        guardianId,
        alertType: 'info',
        message: '어르신의 기분이 좋지 않아 보입니다. 관심이 필요합니다.',
      });
      this.logger.log(`Health alert created wardId=${wardId} type=mood`);
    }
  }
}
