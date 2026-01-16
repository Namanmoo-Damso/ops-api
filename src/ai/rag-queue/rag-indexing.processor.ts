/**
 * RAG Indexing Processor
 *
 * BullMQ 워커에서 실행되는 RAG 인덱싱 작업 프로세서
 *
 * 주요 기능:
 * - 큐에서 작업을 가져와 RAG 인덱싱 실행
 * - 동시성 제어: concurrency=5로 AWS Bedrock 할당량 최적화
 * - 에러 핸들링: error.stack 포함 상세 에러를 DB에 기록
 * - 상태 관리: 인덱싱 진행 상태를 DB에 원자적으로 업데이트
 */
import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';

import {
  DbService,
  IndexingStatus,
  INDEXING_ERROR_MAX_LENGTH,
} from '../../database';
import { RagService } from '../rag.service';
import { TranscriptStore } from '../transcript.store';
import { RagIndexingJobData } from './rag-indexing.producer';
import {
  RAG_INDEXING_QUEUE,
  PROCESSOR_OPTIONS,
} from './rag-queue.constants';

@Processor(RAG_INDEXING_QUEUE, {
  // 동시성 제어: AWS Bedrock 할당량 최적화
  concurrency: PROCESSOR_OPTIONS.CONCURRENCY,
})
export class RagIndexingProcessor extends WorkerHost {
  private readonly logger = new Logger(RagIndexingProcessor.name);

  constructor(
    private readonly dbService: DbService,
    private readonly ragService: RagService,
    private readonly transcriptStore: TranscriptStore,
  ) {
    super();
  }

  /**
   * 작업 처리 메인 핸들러
   *
   * @param job BullMQ Job 인스턴스
   * @returns 인덱싱 결과
   */
  async process(job: Job<RagIndexingJobData>): Promise<{ success: boolean; message: string }> {
    const { callId, wardId, isRetry, retryCount } = job.data;
    const startTime = Date.now();

    this.logger.log(
      `🔧 인덱싱 작업 시작: callId=${callId}, wardId=${wardId}, isRetry=${isRetry}, attempt=${job.attemptsMade + 1}`,
    );

    try {
      // Step 1: 상태를 PROCESSING으로 업데이트 (재시도 횟수 증가)
      await this.dbService.updateIndexingStatus({
        callId,
        status: IndexingStatus.PROCESSING,
        error: null,
        incrementAttempts: true,
      });

      // Step 2: 진행률 업데이트 (10%)
      await job.updateProgress(10);

      // Step 3: Redis에서 트랜스크립트 조회
      const transcriptEntries = await this.transcriptStore.getTranscriptEntries(callId);

      if (!transcriptEntries || transcriptEntries.length === 0) {
        // 트랜스크립트가 없으면 완료 처리 (인덱싱할 내용 없음)
        await this.dbService.updateIndexingStatus({
          callId,
          status: IndexingStatus.COMPLETED,
          error: null,
        });

        this.logger.warn(`⚠️ 트랜스크립트 없음: callId=${callId}, 인덱싱 스킵`);
        return { success: true, message: 'No transcripts to index' };
      }

      // Step 4: 진행률 업데이트 (30%)
      await job.updateProgress(30);

      // Step 5: RAG 인덱싱 실행
      this.logger.log(`📝 RAG 인덱싱 실행: callId=${callId}, lines=${transcriptEntries.length}`);
      await this.ragService.indexConversation(callId, wardId, transcriptEntries);

      // Step 6: 진행률 업데이트 (90%)
      await job.updateProgress(90);

      // Step 7: 상태를 COMPLETED로 업데이트
      await this.dbService.updateIndexingStatus({
        callId,
        status: IndexingStatus.COMPLETED,
        error: null,
      });

      // Step 8: 진행률 업데이트 (100%)
      await job.updateProgress(100);

      const duration = Date.now() - startTime;
      this.logger.log(
        `✅ 인덱싱 완료: callId=${callId}, duration=${duration}ms, chunks=${transcriptEntries.length}`,
      );

      return { success: true, message: `Indexed ${transcriptEntries.length} transcript lines in ${duration}ms` };

    } catch (error) {
      // 에러 발생 시 상세 정보 추출
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorStack = error instanceof Error ? error.stack : undefined;

      // 상세 에러 로그
      this.logger.error(
        `❌ 인덱싱 실패: callId=${callId}, error=${errorMessage}`,
        errorStack,
      );

      // DB에 에러 정보 기록 (stack trace 포함)
      const fullError = errorStack
        ? `${errorMessage}\n\nStack:\n${errorStack}`
        : errorMessage;

      await this.dbService.updateIndexingStatus({
        callId,
        status: IndexingStatus.FAILED,
        error: fullError.substring(0, INDEXING_ERROR_MAX_LENGTH),
      });

      // 에러를 다시 throw하여 BullMQ가 재시도 처리하도록 함
      throw error;
    }
  }

  /**
   * 작업 완료 이벤트 핸들러
   */
  @OnWorkerEvent('completed')
  onCompleted(job: Job<RagIndexingJobData>) {
    this.logger.log(
      `📋 작업 완료 이벤트: jobId=${job.id}, callId=${job.data.callId}`,
    );
  }

  /**
   * 작업 실패 이벤트 핸들러
   */
  @OnWorkerEvent('failed')
  onFailed(job: Job<RagIndexingJobData>, error: Error) {
    this.logger.error(
      `📋 작업 실패 이벤트: jobId=${job.id}, callId=${job.data.callId}, attempts=${job.attemptsMade}, error=${error.message}`,
    );
  }

  /**
   * 작업 진행 이벤트 핸들러
   */
  @OnWorkerEvent('progress')
  onProgress(job: Job<RagIndexingJobData>, progress: number | object) {
    const progressValue = typeof progress === 'number' ? progress : 0;
    this.logger.debug(
      `📋 작업 진행: jobId=${job.id}, callId=${job.data.callId}, progress=${progressValue}%`,
    );
  }
}
