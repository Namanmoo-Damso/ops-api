import { Injectable, Logger } from '@nestjs/common';
import { RagHybridSearchService } from './rag.hybrid-search.service';
import { SearchResult } from './rag.types';

/**
 * RAG Search Service
 *
 * 하이브리드 검색(Vector + FTS)을 제공하는 서비스:
 * - 기존 인터페이스 유지 (하위 호환성)
 * - 내부적으로 HybridSearchService 사용
 * - Vector Search + Full-Text Search + RRF 결합
 */
@Injectable()
export class RagSearchService {
  private readonly logger = new Logger(RagSearchService.name);

  constructor(private readonly hybridSearchService: RagHybridSearchService) {}

  /**
   * Search PGVector for similar conversations using Hybrid Search
   *
   * 기존 메서드 시그니처 유지 (하위 호환성)
   * 내부적으로 하이브리드 검색(Vector + FTS + RRF) 사용
   *
   * @param wardId 어르신 ID
   * @param queryEmbedding 쿼리 임베딩 벡터
   * @param limit 반환할 최대 결과 수
   * @param query 사용자 쿼리 (선택적, FTS에 사용)
   */
  async searchPGVector(
    wardId: string,
    queryEmbedding: number[],
    limit: number,
    query?: string,
  ): Promise<SearchResult[]> {
    try {
      // 하이브리드 검색 실행
      // query가 없으면 빈 문자열 전달 (벡터 검색만 수행)
      const results = await this.hybridSearchService.search(
        wardId,
        query || '',
        queryEmbedding,
        limit,
      );

      return results;
    } catch (error) {
      this.logger.error(`Hybrid search failed: ${error.message}`, error.stack);
      throw error;
    }
  }
}
