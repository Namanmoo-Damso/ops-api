import { Injectable, Logger } from '@nestjs/common';
import { RagSearchRepository } from './rag.search.repository';
import { RagRankFusionService } from './rag.rank-fusion.service';
import { SearchResult } from './rag.types';
import { isValidEmbedding } from './rag.utils';

/**
 * Hybrid Search Service
 *
 * 벡터 검색과 Full-Text Search를 병렬로 실행하고 RRF로 결합하는 오케스트레이션 레이어:
 * - Promise.all로 두 검색을 병렬 실행
 * - 키워드 추출 및 전처리
 * - RRF 알고리즘으로 최종 결과 생성
 */
@Injectable()
export class RagHybridSearchService {
  private readonly logger = new Logger(RagHybridSearchService.name);

  private readonly DEBUG_LOGS = process.env.RAG_DEBUG_LOGS === 'true';

  // 검색 결과 확장 배수 (RRF 적용 전 더 많은 후보 수집)
  private readonly SEARCH_EXPANSION_FACTOR = 2;

  private readonly VECTOR_SEARCH_TIMEOUT_MS = (() => {
    const value = parseInt(
      process.env.RAG_VECTOR_SEARCH_TIMEOUT_MS ||
        process.env.RAG_SEARCH_TIMEOUT_MS ||
        '2000',
      10,
    );
    return Number.isFinite(value) && value > 0 ? value : 2000;
  })();
  private readonly FTS_SEARCH_TIMEOUT_MS = (() => {
    const value = parseInt(
      process.env.RAG_FTS_SEARCH_TIMEOUT_MS ||
        process.env.RAG_SEARCH_TIMEOUT_MS ||
        '2000',
      10,
    );
    return Number.isFinite(value) && value > 0 ? value : 2000;
  })();

  constructor(
    private readonly searchRepository: RagSearchRepository,
    private readonly rankFusionService: RagRankFusionService,
  ) {}

  /**
   * 하이브리드 검색 실행
   *
   * @param wardId 어르신 ID
   * @param query 사용자 쿼리 (키워드 추출용)
   * @param queryEmbedding 쿼리 임베딩 벡터
   * @param limit 최종 반환할 결과 수
   * @returns RRF로 결합된 검색 결과
   */
  async search(
    wardId: string,
    query: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<SearchResult[]> {
    try {
      this.debug(
        `Hybrid search: ward=${wardId.substring(0, 8)}..., query="${query}", limit=${limit}`,
      );

      // Step 1: 키워드 추출
      const keywords = this.extractKeywords(query);
      this.debug(`Extracted keywords: "${keywords}"`);

      // Step 2: 병렬 검색 실행 (더 많은 후보 수집)
      const expandedLimit = limit * this.SEARCH_EXPANSION_FACTOR;

      const hasValidEmbedding = isValidEmbedding(queryEmbedding);
      const vectorSearch = hasValidEmbedding
        ? this.runSearchWithTimeout(
            'vector',
            () =>
              this.searchRepository.searchVector(
                wardId,
                queryEmbedding,
                expandedLimit,
              ),
            this.VECTOR_SEARCH_TIMEOUT_MS,
            [],
          )
        : Promise.resolve([]);

      if (!hasValidEmbedding) {
        this.logger.warn('Invalid embedding detected - skipping vector search');
      }

      const ftsSearch = keywords
        ? this.runSearchWithTimeout(
            'fts',
            () =>
              this.searchRepository.searchFullText(
                wardId,
                keywords,
                expandedLimit,
              ),
            this.FTS_SEARCH_TIMEOUT_MS,
            [],
          )
        : Promise.resolve([]);

      const [vectorResults, ftsResults] = await Promise.all([
        vectorSearch,
        ftsSearch,
      ]);

      this.logger.log(
        `Search completed: vector=${vectorResults.length}, fts=${ftsResults.length}`,
      );

      // Step 3: RRF 적용하여 결과 결합
      const fusedResults = this.rankFusionService.fuseResults(
        vectorResults,
        ftsResults,
        limit,
      );

      this.logger.log(`Hybrid search returned ${fusedResults.length} results`);

      return fusedResults;
    } catch (error) {
      this.logger.error(`Hybrid search failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * 사용자 쿼리에서 검색 키워드 추출
   *
   * @param query 사용자 쿼리
   * @returns 검색 키워드 (trim 처리)
   */
  private extractKeywords(query: string): string {
    if (!query || query.trim().length === 0) {
      return '';
    }

    const normalized = query.trim();
    this.debug(`Extracted keywords from "${query}" -> "${normalized}"`);

    return normalized;
  }

  private debug(message: string): void {
    if (this.DEBUG_LOGS) {
      this.logger.debug(message);
    }
  }

  private async runSearchWithTimeout<T>(
    label: string,
    task: () => Promise<T>,
    timeoutMs: number,
    fallback: T,
  ): Promise<T> {
    const safeTimeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : 0;

    if (!safeTimeoutMs) {
      return this.runSearchSafely(label, task, fallback);
    }

    const taskPromise = this.runSearchSafely(label, task, fallback);
    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const timeoutPromise = new Promise<T>(resolve => {
      timeoutId = setTimeout(() => {
        this.logger.warn(
          `Hybrid search ${label} timed out after ${safeTimeoutMs}ms`,
        );
        resolve(fallback);
      }, safeTimeoutMs);
    });

    const result = await Promise.race([taskPromise, timeoutPromise]);

    if (timeoutId) {
      clearTimeout(timeoutId);
    }

    return result;
  }

  private async runSearchSafely<T>(
    label: string,
    task: () => Promise<T>,
    fallback: T,
  ): Promise<T> {
    try {
      return await task();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Hybrid search ${label} failed: ${message}`);
      return fallback;
    }
  }
}
