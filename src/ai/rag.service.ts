import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

/**
 * RAG Service - Vector Search with PGVector
 *
 * Architecture:
 * - Storage: PGVector (permanent storage for all conversation vectors)
 * - Embeddings: AWS Bedrock Titan Embeddings V2 (1024 dimensions)
 * - Search: Cosine similarity using pgvector extension
 */
@Injectable()
export class RagService implements OnModuleInit {
  private readonly logger = new Logger(RagService.name);
  private bedrockClient: BedrockRuntimeClient;

  // Configuration from environment variables
  private readonly VECTOR_DIMENSIONS = parseInt(
    process.env.VECTOR_DIMENSIONS || '1024',
    10,
  );
  private readonly EMBEDDING_MODEL =
    process.env.EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
  private readonly SEARCH_LIMIT = parseInt(
    process.env.RAG_SEARCH_LIMIT || '5',
    10,
  );
  private readonly CHUNK_SIZE = parseInt(
    process.env.RAG_CHUNK_SIZE || '500',
    10,
  );
  private readonly CHUNK_OVERLAP = parseInt(
    process.env.RAG_CHUNK_OVERLAP || '50',
    10,
  );

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    // Initialize AWS Bedrock client
    const awsRegion = process.env.AWS_REGION || 'ap-northeast-2';
    const awsAccessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const awsSecretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;

    if (!awsAccessKeyId || !awsSecretAccessKey) {
      throw new Error('AWS credentials are required for RAG service');
    }

    this.bedrockClient = new BedrockRuntimeClient({
      region: awsRegion,
      credentials: {
        accessKeyId: awsAccessKeyId,
        secretAccessKey: awsSecretAccessKey,
      },
    });

    this.logger.log('RAG Service initialized (Bedrock Titan Embeddings V2 + PGVector)');
    this.logger.log(
      `Config: Model=${this.EMBEDDING_MODEL}, Dimensions=${this.VECTOR_DIMENSIONS}`,
    );
  }

  /**
   * Index conversation from a call
   * - Accepts transcript data directly (same data used for AI analysis)
   * - Chunks text into smaller pieces
   * - Generates embeddings
   * - Stores in PGVector
   */
  async indexConversation(
    callId: string,
    wardId: string,
    transcripts: Array<{ speaker: string; text: string; timestamp?: string }>,
  ): Promise<void> {
    try {
      this.logger.log(`Indexing conversation: callId=${callId}, wardId=${wardId}`);

      if (!transcripts || transcripts.length === 0) {
        this.logger.warn(`No transcripts provided for call: ${callId}`);
        return;
      }

      // 최근 7일 맥락을 참고하여 청크 구성
      const pastContext = await this.getRecentContext(wardId, 20);
      const pastContextText = pastContext
        .map((c) => c.text)
        .filter(Boolean)
        .join('\n');

      const enrichedChunks = this.buildContextualChunks(transcripts, pastContextText);
      this.logger.log(
        `Created ${enrichedChunks.length} contextual chunk(s) for call: ${callId}`,
      );

      // Generate embeddings and store
      for (const chunk of enrichedChunks) {
        await this.indexChunk(wardId, callId, chunk.content, transcripts, chunk.metadata);
      }

      this.logger.log(
        `Successfully indexed ${enrichedChunks.length} chunk(s) for call: ${callId}`,
      );
    } catch (error) {
      this.logger.error(`Failed to index conversation: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Search for relevant conversation context
   * - Uses PGVector for semantic search
   * - Returns most relevant chunks
   */
  async searchSimilar(
    wardId: string,
    query: string,
    limit?: number,
  ): Promise<Array<{ text: string; metadata: any; similarity: number }>> {
    try {
      const searchLimit = limit || this.SEARCH_LIMIT;
      this.logger.log(`Searching for: "${query}" (ward=${wardId}, limit=${searchLimit})`);

      // Generate query embedding
      const queryEmbedding = await this.generateEmbedding(query);

      // Search PGVector
      this.logger.log(`Searching PGVector for similar contexts...`);
      const pgResults = await this.searchPGVector(
        wardId,
        queryEmbedding,
        searchLimit,
      );

      return pgResults;
    } catch (error) {
      this.logger.error(`Search failed: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Get conversation history for a ward (useful for context building)
   */
  async getRecentContext(
    wardId: string,
    limit: number = 10,
  ): Promise<Array<{ text: string; createdAt: Date }>> {
    try {
      const results = await this.prisma.$queryRaw<
        Array<{ chunk_text: string; created_at: Date }>
      >`
        SELECT chunk_text, created_at
        FROM conversation_vectors
        WHERE ward_id = ${wardId}::uuid
        ORDER BY created_at DESC
        LIMIT ${limit}
      `;

      return results.map((r) => ({
        text: r.chunk_text,
        createdAt: r.created_at,
      }));
    } catch (error) {
      this.logger.error(`Failed to get recent context: ${error.message}`);
      throw error;
    }
  }

  // ========================================================================
  // Private helper methods
  // ========================================================================

  private buildContextualChunks(
    transcripts: Array<{ speaker: string; text: string; timestamp?: string }>,
    pastContextText: string,
  ): Array<{ content: string; metadata: any }> {
    const chunks: Array<{ content: string; metadata: any }> = [];
    let buffer: Array<{ speaker: string; text: string }> = [];
    let sequence = 1;

    const flushBuffer = () => {
      if (buffer.length === 0) return;
      const rawSegment = buffer
        .map((t) => `[${t.speaker}]: ${t.text}`)
        .join('\n');
      const keywords = this.extractKeywords(rawSegment);
      const relatedToPast = this.checkRelatedToPast(keywords, pastContextText);
      const metadata = {
        sequence,
        topic: this.inferTopic(rawSegment),
        raw_transcript_segment: rawSegment,
        keywords,
        related_to_past_7days: relatedToPast,
        source: 'post_call_chunk',
      };

      chunks.push({ content: rawSegment, metadata });
      sequence += 1;
      buffer = [];
    };

    for (const line of transcripts) {
      const addition = `[${line.speaker}]: ${line.text}`;
      const currentLength = buffer.reduce((acc, t) => acc + t.text.length, 0);

      // 새 청크 조건: 길이 초과시만 청크 분리 (전체 대화를 최대한 유지)
      if (buffer.length > 0 && currentLength + line.text.length > this.CHUNK_SIZE) {
        flushBuffer();
      }

      buffer.push({ speaker: line.speaker, text: line.text });
    }

    flushBuffer();
    return chunks;
  }

  private extractKeywords(text: string): string[] {
    const words = text
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .map((w) => w.trim())
      .filter((w) => w.length > 1);

    const unique: string[] = [];
    for (const w of words) {
      if (!unique.includes(w)) {
        unique.push(w);
      }
    }
    return unique.slice(0, 10);
  }

  private checkRelatedToPast(keywords: string[], pastContext: string): boolean {
    if (!pastContext) return false;
    const lowerContext = pastContext.toLowerCase();
    return keywords.some((kw) => lowerContext.includes(kw.toLowerCase()));
  }

  private inferTopic(rawSegment: string): string {
    const firstLine = rawSegment.split('\n')[0] || '';
    const snippet = firstLine.replace(/\[.*?\]:\s*/, '').trim();
    return snippet.substring(0, 30) || '대화 요약';
  }

  private async generateEmbedding(text: string): Promise<number[]> {
    try {
      // Prepare Bedrock Titan Embeddings V2 request
      const requestBody = {
        inputText: text,
        dimensions: this.VECTOR_DIMENSIONS,
        normalize: true, // Normalize vectors for cosine similarity
      };

      const command = new InvokeModelCommand({
        modelId: this.EMBEDDING_MODEL,
        body: JSON.stringify(requestBody),
        contentType: 'application/json',
        accept: 'application/json',
      });

      const response = await this.bedrockClient.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      // Titan V2 returns: { embedding: number[], inputTextTokenCount: number }
      return responseBody.embedding;
    } catch (error) {
      this.logger.error(`Failed to generate embedding: ${error.message}`);
      throw error;
    }
  }

  private async indexChunk(
    wardId: string,
    callId: string,
    chunkText: string,
    transcripts: any[],
    extraMetadata: Record<string, any> = {},
  ): Promise<void> {
    try {
      // Generate embedding
      const embedding = await this.generateEmbedding(chunkText);

      // Extract metadata
      const metadata = {
        speakers: [...new Set(transcripts.map((t) => t.speaker))],
        timestamp: transcripts[0]?.timestamp,
        chunkLength: chunkText.length,
        ...extraMetadata,
      };

      // Store in PGVector only (permanent storage)
      const result = await this.prisma.$executeRaw`
        INSERT INTO conversation_vectors (ward_id, call_id, chunk_text, embedding, metadata)
        VALUES (
          ${wardId}::uuid,
          ${callId}::uuid,
          ${chunkText},
          ${JSON.stringify(embedding)}::vector,
          ${JSON.stringify(metadata)}::jsonb
        )
      `;

      this.logger.debug(`Indexed chunk: ${chunkText.substring(0, 50)}...`);
    } catch (error) {
      this.logger.error(`Failed to index chunk: ${error.message}`);
      throw error;
    }
  }


  private async searchPGVector(
    wardId: string,
    queryEmbedding: number[],
    limit: number,
  ): Promise<Array<{ text: string; metadata: any; similarity: number }>> {
    try {
      const results = await this.prisma.$queryRaw<
        Array<{
          chunk_text: string;
          metadata: any;
          similarity: number;
        }>
      >`
        SELECT
          chunk_text,
          metadata,
          1 - (embedding <=> ${JSON.stringify(queryEmbedding)}::vector) AS similarity
        FROM conversation_vectors
        WHERE ward_id = ${wardId}::uuid
        ORDER BY embedding <=> ${JSON.stringify(queryEmbedding)}::vector
        LIMIT ${limit}
      `;

      return results.map((r) => ({
        text: r.chunk_text,
        metadata: r.metadata,
        similarity: r.similarity,
      }));
    } catch (error) {
      this.logger.error(`PGVector search failed: ${error.message}`);
      throw error;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Vectors must have same dimensions');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }
}
