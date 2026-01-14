import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { createBedrockRuntimeClient } from '../bedrock/bedrock-client.factory';

/**
 * RAG Embedding Service
 *
 * Handles embedding generation using AWS Bedrock Titan Embeddings V2
 * - Generates 1024-dimensional embeddings
 * - Includes retry logic with exponential backoff
 * - Handles network errors and rate limiting
 */
@Injectable()
export class RagEmbeddingService implements OnModuleInit {
  private readonly logger = new Logger(RagEmbeddingService.name);
  private bedrockClient: BedrockRuntimeClient;

  private readonly VECTOR_DIMENSIONS = parseInt(
    process.env.VECTOR_DIMENSIONS || '1024',
    10,
  );
  private readonly EMBEDDING_MODEL =
    process.env.EMBEDDING_MODEL || 'amazon.titan-embed-text-v2:0';
  private readonly BEDROCK_MAX_RETRIES = parseInt(
    process.env.BEDROCK_MAX_RETRIES || '3',
    10,
  );
  private readonly BEDROCK_RETRY_DELAY = parseInt(
    process.env.BEDROCK_RETRY_DELAY_MS || '1000',
    10,
  );
  private readonly BEDROCK_RETRY_BACKOFF = parseInt(
    process.env.BEDROCK_RETRY_BACKOFF_FACTOR || '2',
    10,
  );
  private readonly DEBUG_LOGS = process.env.RAG_DEBUG_LOGS === 'true';

  async onModuleInit() {
    const awsRegion = process.env.AWS_REGION || 'ap-northeast-2';

    this.bedrockClient = createBedrockRuntimeClient({ region: awsRegion });

    this.logger.log(
      `Embedding service initialized: ${this.EMBEDDING_MODEL} (${this.VECTOR_DIMENSIONS}D)`,
    );
  }

  /**
   * Generate embedding with retry logic
   */
  async generateEmbedding(text: string): Promise<number[]> {
    const startTime = Date.now();
    if (this.DEBUG_LOGS) {
      const truncatedText = text.substring(0, 100);
      this.logger.debug(
        `🔄 Bedrock embedding request: "${truncatedText}${text.length > 100 ? '...' : ''}" (${text.length} chars)`,
      );
    }

    try {
      const embedding = await this.retryAsync(
        async () => {
          const requestBody = {
            inputText: text,
            dimensions: this.VECTOR_DIMENSIONS,
            normalize: true,
          };

          const command = new InvokeModelCommand({
            modelId: this.EMBEDDING_MODEL,
            body: JSON.stringify(requestBody),
            contentType: 'application/json',
            accept: 'application/json',
          });

          if (this.DEBUG_LOGS) {
            this.logger.debug(`📡 Sending request to Bedrock...`);
          }
          const response = await this.bedrockClient.send(command);
          const responseBody = JSON.parse(
            new TextDecoder().decode(response.body),
          );

          return responseBody.embedding;
        },
        this.BEDROCK_MAX_RETRIES,
        this.BEDROCK_RETRY_DELAY,
        this.BEDROCK_RETRY_BACKOFF,
        'generate embedding',
      );

      const elapsed = Date.now() - startTime;
      if (this.DEBUG_LOGS) {
        this.logger.debug(
          `✅ Bedrock embedding generated in ${elapsed}ms (${embedding.length} dimensions)`,
        );
      }

      return embedding;
    } catch (error) {
      const elapsed = Date.now() - startTime;
      this.logger.error(
        `❌ Bedrock embedding failed after ${elapsed}ms: ${error.message}`,
        error.stack,
      );
      throw error;
    }
  }

  /**
   * Get BedrockClient instance for other services (e.g., GreetingGenerator)
   */
  getBedrockClient(): BedrockRuntimeClient {
    if (!this.bedrockClient) {
      throw new Error(
        'BedrockClient not initialized. Call onModuleInit first.',
      );
    }
    return this.bedrockClient;
  }

  /**
   * Generic retry helper with exponential backoff
   */
  private async retryAsync<T>(
    fn: () => Promise<T>,
    maxRetries: number,
    delayMs: number,
    backoffFactor: number,
    operationName: string,
  ): Promise<T> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const isRetryable = this.isRetryableError(error);

        if (attempt < maxRetries - 1 && isRetryable) {
          const currentDelay = delayMs * Math.pow(backoffFactor, attempt);
          this.logger.warn(
            `${operationName} failed (attempt ${attempt + 1}/${maxRetries}): ${error.message}. Retrying in ${currentDelay}ms...`,
          );
          await this.sleep(currentDelay);
        } else {
          this.logger.error(
            `Failed to ${operationName} after ${attempt + 1} attempt(s): ${error.message}`,
            error instanceof Error ? error.stack : undefined,
          );
          break;
        }
      }
    }

    throw lastError || new Error(`Failed to ${operationName}`);
  }

  /**
   * Check if error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    const err = error as {
      code?: string;
      name?: string;
      $metadata?: { httpStatusCode?: number };
    };

    if (
      err.code === 'ECONNRESET' ||
      err.code === 'ETIMEDOUT' ||
      err.code === 'ENOTFOUND'
    ) {
      return true;
    }

    if (
      err.name === 'ThrottlingException' ||
      err.name === 'TooManyRequestsException'
    ) {
      return true;
    }

    if (
      err.name === 'ServiceUnavailableException' ||
      err.$metadata?.httpStatusCode === 503
    ) {
      return true;
    }

    return false;
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
