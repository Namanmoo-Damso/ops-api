import {
  Controller,
  Post,
  Get,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Logger,
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

    this.logger.log(`Received index request: callId=${callId}, wardId=${wardId}`);

    // Fetch transcript entries from Redis
    const transcriptEntries = await this.transcriptStore.getTranscriptEntries(callId);

    if (!transcriptEntries || transcriptEntries.length === 0) {
      this.logger.warn(`No transcripts found for callId=${callId}`);
      return {
        message: 'No transcripts available for indexing',
      };
    }

    // Index asynchronously (don't wait for completion)
    this.ragService
      .indexConversation(callId, wardId, transcriptEntries)
      .catch((error) => {
        this.logger.error(
          `Background indexing failed for call ${callId}: ${error.message}`,
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
    results: Array<{ text: string; metadata: any; similarity: number }>;
  }> {
    if (!wardId || !query) {
      throw new Error('wardId and query are required');
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
      throw new Error('wardId is required');
    }

    const contextLimit = limit ? parseInt(limit, 10) : 10;
    const context = await this.ragService.getRecentContext(
      wardId,
      contextLimit,
    );

    return { context };
  }
}
