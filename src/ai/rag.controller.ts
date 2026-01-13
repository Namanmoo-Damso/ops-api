import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
  BadRequestException,
} from '@nestjs/common';
import { RagService } from './rag.service';
import { TranscriptStore } from './transcript.store';

/**
 * RAG Controller
 * Handles vector indexing and similarity search endpoints
 *
 * Note: Authentication should be added in production by uncommenting @UseGuards(JwtAuthGuard)
 * and importing JwtAuthGuard from '../common/guards/jwt-auth.guard'
 */
@Controller('v1/rag')
export class RagController {
  private readonly logger = new Logger(RagController.name);

  constructor(
    private readonly ragService: RagService,
    private readonly transcriptStore: TranscriptStore,
  ) {}

  /**
   * Index a conversation after call ends
   * POST /v1/rag/index
   *
   * Body:
   * {
   *   "callId": "uuid",
   *   "wardId": "uuid"
   * }
   *
   * Note: This endpoint is now primarily for manual/testing purposes.
   * In production, RAG indexing happens automatically during AI analysis.
   */
  @Post('index')
  @HttpCode(HttpStatus.ACCEPTED)
  async indexConversation(
    @Body() body: { callId: string; wardId: string },
  ): Promise<{ message: string }> {
    const { callId, wardId } = body;

    this.logger.log(
      `Received index request: callId=${callId}, wardId=${wardId}`,
    );

    // Fetch transcript entries from Redis
    const transcriptEntries =
      await this.transcriptStore.getTranscriptEntries(callId);

    if (!transcriptEntries || transcriptEntries.length === 0) {
      this.logger.warn(`No transcripts found for callId=${callId}`);
      return {
        message: 'No transcripts available for indexing',
      };
    }

    // Index asynchronously (don't wait for completion)
    this.ragService
      .indexConversation(callId, wardId, transcriptEntries)
      .catch(error => {
        this.logger.error(
          `Background indexing failed for call ${callId}: ${error.message}`,
          error.stack,
        );
      });

    return {
      message: 'Indexing started',
    };
  }

  /**
   * Search for similar conversations
   * GET /v1/rag/search?wardId=uuid&query=text&limit=5
   */
  @Get('search')
  async search(
    @Query('wardId') wardId: string,
    @Query('query') query: string,
    @Query('limit') limit?: string,
  ): Promise<{
    results: Array<{
      text: string;
      metadata: any;
      similarity: number;
      createdAt: string;
      callId: string;
    }>;
  }> {
    if (!wardId || !query) {
      throw new BadRequestException('wardId and query are required');
    }

    const searchLimit = limit ? parseInt(limit, 10) : undefined;
    const results = await this.ragService.searchSimilar(
      wardId,
      query,
      searchLimit,
    );

    return { results };
  }

  /**
   * Get recent conversation context for a ward
   * GET /v1/rag/context?wardId=uuid&limit=10
   */
  @Get('context')
  async getContext(
    @Query('wardId') wardId: string,
    @Query('limit') limit?: string,
  ): Promise<{
    context: Array<{ text: string; createdAt: Date }>;
  }> {
    if (!wardId) {
      throw new BadRequestException('wardId is required');
    }

    const contextLimit = limit ? parseInt(limit, 10) : 10;
    const context = await this.ragService.getRecentContext(
      wardId,
      contextLimit,
    );

    return { context };
  }

  /**
   * Preload weekly context into Redis cache when call starts
   * POST /v1/rag/preload
   *
   * Body:
   * {
   *   "wardId": "uuid",
   *   "callDirection": "inbound" | "outbound" (REQUIRED - must specify call direction)
   * }
   *
   * This should be called when participants join the room (before first greeting)
   * Now also generates and caches personalized greeting
   */
  @Post('preload')
  @HttpCode(HttpStatus.OK)
  async preloadContext(
    @Body() body: { wardId: string; callDirection?: 'inbound' | 'outbound' },
  ): Promise<{ message: string; greeting: string }> {
    const { wardId, callDirection } = body;

    if (!wardId) {
      throw new BadRequestException('wardId is required');
    }

    if (!callDirection) {
      throw new BadRequestException(
        'callDirection is required (inbound or outbound)',
      );
    }

    if (callDirection !== 'inbound' && callDirection !== 'outbound') {
      throw new BadRequestException(
        'callDirection must be either "inbound" or "outbound"',
      );
    }

    this.logger.log(
      `Preloading context and greeting for ward: ${wardId}, direction: ${callDirection}`,
    );

    try {
      // Preload both weekly context and personalized greeting synchronously
      const [_, greeting] = await Promise.all([
        this.ragService.preloadWeeklyContext(wardId),
        this.ragService.generatePersonalizedGreeting(wardId, callDirection),
      ]);

      return {
        message: 'Context and greeting preload completed',
        greeting,
      };
    } catch (error) {
      this.logger.error(
        `Preload failed for ward ${wardId}: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Generate personalized greeting for ward
   * POST /v1/rag/greeting/generate
   *
   * Body:
   * {
   *   "wardId": "uuid",
   *   "callDirection": "inbound" | "outbound" (REQUIRED - must specify call direction)
   * }
   *
   * Returns personalized greeting based on last 7 days of conversation context
   */
  @Post('greeting/generate')
  @HttpCode(HttpStatus.OK)
  async generateGreeting(
    @Body() body: { wardId: string; callDirection?: 'inbound' | 'outbound' },
  ): Promise<{ greeting: string }> {
    const { wardId, callDirection } = body;

    if (!wardId) {
      throw new BadRequestException('wardId is required');
    }

    if (!callDirection) {
      throw new BadRequestException(
        'callDirection is required (inbound or outbound)',
      );
    }

    if (callDirection !== 'inbound' && callDirection !== 'outbound') {
      throw new BadRequestException(
        'callDirection must be either "inbound" or "outbound"',
      );
    }

    this.logger.log(
      `Generating greeting for ward: ${wardId}, direction: ${callDirection}`,
    );

    const greeting = await this.ragService.generatePersonalizedGreeting(
      wardId,
      callDirection,
    );

    return { greeting };
  }

  /**
   * Get performance metrics
   * GET /v1/rag/metrics
   *
   * Returns cache hit rate and search response times
   */
  @Get('metrics')
  async getMetrics(): Promise<{
    cacheHitRate: number;
    avgRedisSearchTime: number;
    avgPgvectorSearchTime: number;
    totalSearches: number;
    cacheHits: number;
    cacheMisses: number;
  }> {
    return this.ragService.getPerformanceMetrics();
  }

  /**
   * Reset performance metrics
   * POST /v1/rag/metrics/reset
   *
   * Resets all performance counters to zero
   */
  @Post('metrics/reset')
  @HttpCode(HttpStatus.OK)
  async resetMetrics(): Promise<{ message: string }> {
    this.ragService.resetPerformanceMetrics();
    return { message: 'Performance metrics reset successfully' };
  }
}
