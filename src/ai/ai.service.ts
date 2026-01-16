import { Injectable, Logger, Optional } from '@nestjs/common';
import { DbService } from '../database';
import { AiAnalysisProvider } from './ai.interface';
import { TranscriptStore } from './transcript.store';
import { RagService } from './rag.service';
import { RagIndexingProducer } from './rag-queue/rag-indexing.producer';
import { AnalyzeCallResult, AiResponse } from './types';

@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);

  constructor(
    private readonly dbService: DbService,
    private readonly aiProvider: AiAnalysisProvider,
    private readonly transcriptStore: TranscriptStore,
    private readonly ragService: RagService,
    // Optional: 워커 모듈에서는 Producer가 없을 수 있음
    @Optional() private readonly ragIndexingProducer?: RagIndexingProducer,
  ) {}

  private hasIndexingProducer(
    producer?: RagIndexingProducer,
  ): producer is RagIndexingProducer {
    return Boolean(producer);
  }

  async analyzeCall(callId: string): Promise<AnalyzeCallResult> {
    this.logger.log(`analyzeCall callId=${callId}`);

    // 1. 통화 정보 가져오기
    const callInfo = await this.dbService.getCallForAnalysis(callId);
    if (!callInfo) {
      throw new Error(`Call not found: ${callId}`);
    }

    this.logger.log(
      `Call info ready for analysis callId=${callId} ward=${callInfo.ward_id ?? 'null'} guardian=${callInfo.guardian_id ?? 'null'}`,
    );

    let transcript = callInfo.transcript;
    if (!transcript) {
      transcript = await this.transcriptStore.getTranscript(callId);
    }

    if (!transcript) {
      this.logger.warn(`No transcript found for callId=${callId}`);
      return {
        success: false,
        callId,
        error: 'No transcript available',
      };
    }

    // 2. AI 분석
    this.logger.log(
      `Transcript length=${transcript.length} for callId=${callId}, invoking AI analysis`,
    );

    const analysis = await this.aiProvider.analyze(transcript);

    if (!analysis.success) {
      this.logger.warn(
        `Analysis failed for callId=${callId}: ${analysis.error}`,
      );
      return {
        success: false,
        callId,
        error: analysis.error,
      };
    }

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

    this.logger.log(
      `Call summary stored callId=${callId} summaryId=${summary.id} mood=${analysis.mood} moodScore=${analysis.moodScore.toFixed(
        2,
      )}`,
    );

    // 4. 건강 알림 체크 및 생성
    if (callInfo.ward_id && callInfo.guardian_id) {
      await this.checkHealthAlerts(
        callInfo.ward_id,
        callInfo.guardian_id,
        analysis,
      );
    }

    // 5. RAG 벡터 DB 인덱싱 (BullMQ 큐로 비동기 처리)
    // 워커 컨테이너에서 처리하여 API 서버 부하 분리
    if (callInfo.ward_id) {
      if (this.hasIndexingProducer(this.ragIndexingProducer)) {
        // BullMQ를 통한 큐 기반 인덱싱 (권장)
        this.ragIndexingProducer
          .addIndexingJob(callId, callInfo.ward_id)
          .then((jobId) => {
            this.logger.log(
              `RAG indexing job enqueued: callId=${callId}, jobId=${jobId}`,
            );
          })
          .catch((error) => {
            // 큐 등록 실패 시 로깅 (전체 분석에 영향 없음)
            this.logger.error(
              `Failed to enqueue RAG indexing job: callId=${callId}, error=${error.message}`,
            );
          });
      } else {
        // Fallback: Producer가 없으면 직접 인덱싱 (기존 방식)
        this.logger.warn(
          `RagIndexingProducer not registered. Running direct indexing: callId=${callId}`,
        );
        this.transcriptStore.getTranscriptEntries(callId)
          .then((transcriptEntries) => {
            if (transcriptEntries && transcriptEntries.length > 0) {
              return this.ragService.indexConversation(callId, callInfo.ward_id!, transcriptEntries);
            }
          })
          .then(() => {
            this.logger.log(`RAG indexing completed for callId=${callId}`);
          })
          .catch((error) => {
            this.logger.error(`RAG indexing failed for callId=${callId}: ${error.message}`);
          });
      }
    }

    this.logger.log(
      `analyzeCall completed callId=${callId} mood=${analysis.mood}`,
    );

    return {
      success: true,
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
    analysis: AiResponse,
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
