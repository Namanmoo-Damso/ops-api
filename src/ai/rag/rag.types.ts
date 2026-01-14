/**
 * Common types for RAG system
 */

export interface SearchResult {
  text: string;
  metadata: any;
  similarity: number;
  createdAt: string;
  callId: string;
  // Parent-Child structure fields
  childText?: string;      // Original child chunk text
  parentText?: string;     // Full parent context text
  parentId?: string;       // Parent document ID
  snippet?: string;        // Assembled context snippet (parent window around child)
  offsetStart?: number;    // Child position in parent (start)
  offsetEnd?: number;      // Child position in parent (end)
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
