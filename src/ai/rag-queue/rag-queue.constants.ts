/**
 * RAG Queue Constants
 *
 * BullMQ 큐 관련 상수 정의
 */

// 큐 이름
export const RAG_INDEXING_QUEUE = 'rag-indexing';

// 작업 타입
export const RAG_INDEXING_JOB = 'index-conversation';

// 작업 설정 기본값
export const DEFAULT_JOB_OPTIONS = {
  // DB 트랜잭션 완료 후 작업 시작을 위한 지연 시간 (레이스 컨디션 방지)
  DELAY_MS: 1000,

  // 최대 재시도 횟수
  MAX_ATTEMPTS: 3,

  // 재시도 간 대기 시간 (지수 증가 기본값)
  BACKOFF_DELAY_MS: 5000,
};

// 프로세서 설정
export const PROCESSOR_OPTIONS = {
  // 동시 처리 작업 수 (AWS Bedrock 할당량 최적화)
  CONCURRENCY: 5,
};
