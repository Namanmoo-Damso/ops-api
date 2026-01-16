/**
 * RAG Indexing Producer
 *
 * RAG 인덱싱 작업을 BullMQ 큐에 등록하는 프로듀서
 *
 * 주요 기능:
 * - 통화 종료 후 인덱싱 작업 큐에 등록
 * - 1초 지연으로 DB 트랜잭션 완료 보장 (레이스 컨디션 방지)
 * - 실패한 작업 수동 재시도 지원
 */
import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import {
  RAG_INDEXING_QUEUE,
  RAG_INDEXING_JOB,
  INDEXING_JOB_DELAY_MS,
} from './rag-queue.constants';

// 인덱싱 작업 데이터 타입
export interface RagIndexingJobData {
  callId: string;
  wardId: string;
  // 재시도 시 사용되는 메타데이터
  isRetry?: boolean;
  retryCount?: number;
}

@Injectable()
export class RagIndexingProducer {
  private readonly logger = new Logger(RagIndexingProducer.name);

  constructor(
    @InjectQueue(RAG_INDEXING_QUEUE)
    private readonly ragIndexingQueue: Queue<RagIndexingJobData>,
  ) {}

  /**
   * RAG 인덱싱 작업을 큐에 등록
   *
   * @param callId 통화 ID
   * @param wardId 어르신 ID
   * @returns 생성된 Job ID
   *
   * 특징:
   * - 지연 시간 적용: DB 트랜잭션 완료 후 작업 시작 보장
   * - 중복 방지: callId를 Job ID로 사용하여 중복 등록 방지
   */
  async addIndexingJob(callId: string, wardId: string): Promise<string> {
    const jobData: RagIndexingJobData = {
      callId,
      wardId,
      isRetry: false,
    };

    const job = await this.ragIndexingQueue.add(RAG_INDEXING_JOB, jobData, {
      // Job ID를 callId로 설정하여 중복 방지
      jobId: `index-${callId}`,
      // 지연 시간 적용: DB 트랜잭션 완료 보장
      delay: INDEXING_JOB_DELAY_MS,
    });

    this.logger.log(
      `Indexing job enqueued: callId=${callId}, jobId=${job.id}, delay=${INDEXING_JOB_DELAY_MS}ms`,
    );

    return job.id!;
  }

  /**
   * 실패한 작업 수동 재시도
   *
   * @param callId 통화 ID
   * @param wardId 어르신 ID
   * @param retryCount 현재 재시도 횟수
   * @returns 생성된 Job ID
   *
   * 컨트롤러의 POST /v1/rag/retry/:callId 엔드포인트에서 호출
   */
  async retryIndexingJob(
    callId: string,
    wardId: string,
    retryCount: number = 0,
  ): Promise<string> {
    const jobData: RagIndexingJobData = {
      callId,
      wardId,
      isRetry: true,
      retryCount: retryCount + 1,
    };

    // 기존 작업이 있으면 제거 후 새로 등록
    const existingJob = await this.ragIndexingQueue.getJob(`index-${callId}`);
    if (existingJob) {
      await existingJob.remove();
      this.logger.log(`Removed existing job before retry: callId=${callId}`);
    }

    const job = await this.ragIndexingQueue.add(RAG_INDEXING_JOB, jobData, {
      jobId: `retry-${callId}-${Date.now()}`,
      // 재시도는 즉시 실행
      delay: 0,
    });

    this.logger.log(
      `Retry job enqueued: callId=${callId}, jobId=${job.id}, retryCount=${retryCount + 1}`,
    );

    return job.id!;
  }

  /**
   * 큐 상태 조회 (모니터링용)
   */
  async getQueueStatus(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.ragIndexingQueue.getWaitingCount(),
      this.ragIndexingQueue.getActiveCount(),
      this.ragIndexingQueue.getCompletedCount(),
      this.ragIndexingQueue.getFailedCount(),
      this.ragIndexingQueue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * 특정 작업 상태 조회
   */
  async getJobStatus(
    callId: string,
  ): Promise<{ state: string; progress: number } | null> {
    const job = await this.ragIndexingQueue.getJob(`index-${callId}`);
    if (!job) return null;

    const state = await job.getState();
    const progress =
      typeof job.progress === 'number' ? job.progress : 0;

    return { state, progress };
  }
}
