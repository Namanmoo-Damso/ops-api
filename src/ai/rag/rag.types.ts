/**
 * Common types for RAG system
 *
 * 이 파일은 RAG 시스템 전체에서 사용되는 타입과 인터페이스를 정의합니다.
 * - SearchResult: 검색 결과 구조
 * - ContextResult: 문맥 결과 구조
 * - PerformanceMetrics: 성능 메트릭
 * - TranscriptLine: 원본 대화 한 줄
 * - DenseSummaryResult: LLM 요약 결과
 * - ContextualChunk: 문맥 헤더가 포함된 청크
 * - RagIndexResult: 인덱싱 결과
 */

// =============================================================================
// 검색 관련 타입
// =============================================================================

export type RagMetadata = Record<string, unknown>;

export interface SearchResult {
  text: string;
  metadata: RagMetadata;
  similarity: number;
  createdAt: string;
  callId: string;
  // Parent-Child structure fields
  childText?: string; // Original child chunk text
  parentText?: string; // Full parent context text
  parentId?: string; // Parent document ID
  snippet?: string; // Assembled context snippet (parent window around child)
  offsetStart?: number; // Child position in parent (start)
  offsetEnd?: number; // Child position in parent (end)
}

export interface ContextResult {
  text: string;
  createdAt: Date;
}

// =============================================================================
// 성능 메트릭 타입
// =============================================================================

export interface PerformanceMetrics {
  cacheHitRate: number;
  avgRedisSearchTime: number;
  avgPgvectorSearchTime: number;
  totalSearches: number;
  cacheHits: number;
  cacheMisses: number;
}

// =============================================================================
// 트랜스크립트 관련 타입
// =============================================================================

export interface TranscriptLine {
  speaker: string;
  text: string;
  timestamp?: string | number;
}

// =============================================================================
// Dense Summary 관련 타입
// =============================================================================

/**
 * 문맥 헤더가 포함된 청크
 *
 * header: [YYYY-MM-DD | 주제 | 키워드1, 키워드2] 형식
 * content: 청크 본문 (150-200자)
 * fullText: header + content 결합본 (임베딩에 사용)
 */
export interface ContextualChunk {
  header: string;
  content: string;
  fullText: string;
}

/**
 * LLM 요약 결과
 *
 * summaryText: 전체 상세 요약본
 * chunks: 헤더가 포함된 청크 배열
 * metadata: 원본 길이, 요약 길이, 주제, 키워드 등
 */
export interface DenseSummaryResult {
  summaryText: string;
  chunks: ContextualChunk[];
  metadata: {
    originalLength: number;
    summaryLength: number;
    chunkCount: number;
    topics: string[];
    keywords: string[];
  };
}

// =============================================================================
// 인덱싱 관련 타입
// =============================================================================

/**
 * 임베딩이 완료된 청크 (DB 저장 대기)
 */
export interface EmbeddedChunk {
  chunk: ContextualChunk;
  embeddingStr: string;
  index: number;
}

/**
 * v1 Raw 방식 - Child 청크
 */
export interface ChildChunk {
  text: string;
  offsetStart: number;
  offsetEnd: number;
}

/**
 * v1 Raw 방식 - 임베딩된 Child 청크
 */
export interface EmbeddedChildChunk {
  chunk: ChildChunk;
  embeddingStr: string;
  metadataStr: string;
}

/**
 * 인덱싱 결과
 */
export interface RagIndexResult {
  success: boolean;
  parentId?: string;
  childCount: number;
  indexVersion: 'v1-raw' | 'v2-dense-summary';
  error?: string;
}

/**
 * Parent 메타데이터
 */
export interface ParentMetadata {
  speakers: string[];
  timestamp?: string | number;
  callDate: string;
  callStartAt: string;
  topics?: string[];
  keywords?: string[];
  originalLength?: number;
  summaryLength?: number;
  chunkCount?: number;
  parentLength?: number;
  indexVersion: 'v1-raw' | 'v2-dense-summary';
}

// =============================================================================
// 청킹 관련 타입
// =============================================================================

/**
 * Parent 청크 (원본 대화를 분할한 것)
 */
export interface ParentChunk {
  text: string;
  transcripts: TranscriptLine[];
}
