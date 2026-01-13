/**
 * Common types for RAG system
 */

export interface SearchResult {
  text: string;
  metadata: any;
  similarity: number;
  createdAt: string;
  callId: string;
}

export interface ContextResult {
  text: string;
  createdAt: Date;
}

export interface PerformanceMetrics {
  cacheHitRate: number;
  avgRedisSearchTime: number;
  avgPgvectorSearchTime: number;
  totalSearches: number;
  cacheHits: number;
  cacheMisses: number;
}

export interface TranscriptLine {
  speaker: string;
  text: string;
  timestamp?: number;
}
