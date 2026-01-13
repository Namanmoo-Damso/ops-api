import { Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { type RedisClientType } from 'redis';

type ContextEntry = { text: string; createdAt: Date };

export type GreetingConfig = {
  llmModel: string;
  maxContextChars: number;
  maxGreetingTokens: number;
  redisGreetingTTL: number;
};

type GreetingDeps = {
  logger: Logger;
  bedrockClient: () => BedrockRuntimeClient; // Lazy getter to avoid initialization order issues
  redisClient: () => RedisClientType | null; // Lazy getter to avoid initialization order issues
  getRecentContext: (wardId: string, limit?: number) => Promise<ContextEntry[]>;
  getGreetingCacheKey: (wardId: string) => string;
};

export class GreetingGenerator {
  constructor(
    private readonly deps: GreetingDeps,
    private readonly config: GreetingConfig,
  ) {}

  async generatePersonalizedGreeting(
    wardId: string,
    callDirection: 'inbound' | 'outbound' = 'inbound',
  ): Promise<string> {
    try {
      this.deps.logger.log(
        `Generating personalized greeting for ward=${wardId}, direction=${callDirection}`,
      );

      const recentContext = await this.deps.getRecentContext(wardId, 7);

      if (!recentContext || recentContext.length === 0) {
        this.deps.logger.log(
          `No conversation history for ward=${wardId}, using standard greeting`,
        );
        const standardGreeting = this.getStandardGreeting(callDirection);

        return standardGreeting;
      }

      // Build context summary with size limit
      let contextText = recentContext.map(ctx => ctx.text).join('\n\n');

      // Truncate context if too long (prevent excessive token usage)
      if (contextText.length > this.config.maxContextChars) {
        this.deps.logger.warn(
          `Context too long (${contextText.length} chars), truncating to ${this.config.maxContextChars}`,
        );
        contextText =
          contextText.substring(0, this.config.maxContextChars) +
          '\n...(truncated)';
      }

      // Calculate time since last conversation
      const lastConversationDate = recentContext[0]?.createdAt;
      const timeSinceLastCall = lastConversationDate
        ? this.getTimeSinceLastCall(lastConversationDate)
        : null;

      // Generate greeting using Claude
      const greeting = await this.generateGreetingWithLLM(
        contextText,
        timeSinceLastCall,
        callDirection,
      );

      // Validate greeting before caching
      if (!this.isValidGreeting(greeting)) {
        this.deps.logger.warn(
          `Empty greeting generated, using standard greeting`,
        );
        return this.getStandardGreeting(callDirection);
      }

      // Cache in Redis for fast retrieval
      const redisClient = this.deps.redisClient();
      if (redisClient) {
        const greetingKey = this.deps.getGreetingCacheKey(wardId);
        await redisClient.setEx(
          greetingKey,
          this.config.redisGreetingTTL,
          greeting,
        );
        this.deps.logger.log(`✅ Cached greeting in Redis: ${greetingKey}`);

        // 🚀 Publish to Pub/Sub channel for Push-based delivery
        const greetingChannel = `greeting:ward:${wardId}`;
        await redisClient.publish(greetingChannel, greeting);
        this.deps.logger.log(
          `📡 Published greeting to channel: ${greetingChannel}`,
        );
      } else {
        this.deps.logger.warn(
          `⚠️ Redis client not available, greeting not cached/published for ward=${wardId}`,
        );
      }

      return greeting;
    } catch (error) {
      this.deps.logger.error(
        `Failed to generate personalized greeting: ${(error as Error).message}`,
        (error as Error).stack,
      );
      // Return standard greeting on failure
      return this.getStandardGreeting(callDirection);
    }
  }

  private async generateGreetingWithLLM(
    contextText: string,
    timeSinceLastCall: string | null,
    callDirection: 'inbound' | 'outbound',
  ): Promise<string> {
    try {
      const systemPrompt = this.buildGreetingSystemPrompt(callDirection);
      const userPrompt = this.buildGreetingUserPrompt(
        contextText,
        timeSinceLastCall,
      );

      const requestBody = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: this.config.maxGreetingTokens,
        temperature: 0.7,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
      };

      const command = new InvokeModelCommand({
        modelId: this.config.llmModel,
        body: JSON.stringify(requestBody),
        contentType: 'application/json',
        accept: 'application/json',
      });

      // Get BedrockClient lazily
      const bedrockClient = this.deps.bedrockClient();
      const response = await bedrockClient.send(command);

      // Parse response with guards
      if (!response.body) {
        this.deps.logger.error('Empty response body from Bedrock');
        throw new Error('Empty response from LLM');
      }

      const responseBody = JSON.parse(new TextDecoder().decode(response.body));
      const greeting = this.parseGreetingFromResponse(responseBody);

      this.deps.logger.log(
        `Generated greeting (${greeting.length} chars): ${greeting.substring(0, 50)}...`,
      );

      return greeting;
    } catch (error) {
      this.deps.logger.error(
        `LLM greeting generation failed: ${(error as Error).message}`,
        (error as Error).stack,
      );
      throw error;
    }
  }

  private isValidGreeting(text: string | null | undefined): text is string {
    return !!text && text.trim().length > 0;
  }

  private parseGreetingFromResponse(responseBody: any): string {
    if (!responseBody) {
      throw new Error('Empty LLM response');
    }

    const content = responseBody.content;
    if (!Array.isArray(content) || content.length === 0) {
      throw new Error('Empty content in LLM response');
    }

    const firstContent = content[0];
    if (!firstContent || typeof firstContent.text !== 'string') {
      throw new Error('Invalid content format in LLM response');
    }

    const greeting = firstContent.text.trim();
    if (!greeting) {
      throw new Error('Empty greeting text in LLM response');
    }

    return greeting;
  }

  private buildGreetingSystemPrompt(
    callDirection: 'inbound' | 'outbound',
  ): string {
    const basePrompt = `당신은 '소담'이라는 이름의 따뜻한 AI 어르신 돌봄 동반자입니다.

# 역할: 다이내믹 인사말 생성 전문가

어르신과의 최근 대화 맥락을 분석하여 개인화된 첫 인사말을 생성합니다.

# 인사말 생성 가이드라인

1. **맥락 활용**: 최근 7일 대화 내용에서 어르신의 관심사(건강, 가족, 감정 상태)를 파악하여 첫 문장에 자연스럽게 녹여내세요.

2. **시간 감각 유지**: 마지막 대화 이후 경과 시간을 고려하여 적절한 어법을 사용하세요.
   - 당일/전날: "아까", "조금 전", "어제"
   - 며칠 전: "며칠 전", "요 며칠"
   - 일주일 이상: "오랜만이에요", "그동안"

3. **대화 유도**: 단순 정보 나열이 아닌, 어르신이 답변하기 편한 따뜻한 공감형 문장으로 끝맺으세요.

4. **길이**: 1-2문장으로 간결하게 작성하세요.

5. **존댓말**: 항상 정중한 존댓말을 사용하세요.

6. **자연스러움**: 억지로 정보를 끼워넣지 말고, 자연스러운 흐름을 유지하세요.`;

    if (callDirection === 'outbound') {
      return (
        basePrompt +
        `\n\n# 통화 방향: 발신 (에이전트가 어르신께 전화를 건 상황)\n시작: "안녕하세요 어르신, 저 소담이에요."로 시작한 후 맥락을 추가하세요.`
      );
    } else {
      return (
        basePrompt +
        `\n\n# 통화 방향: 수신 (어르신이 에이전트에게 전화를 건 상황)\n시작: "네, 여보세요. 소담입니다."로 시작한 후 맥락을 추가하세요.`
      );
    }
  }

  private buildGreetingUserPrompt(
    contextText: string,
    timeSinceLastCall: string | null,
  ): string {
    let prompt = `# 최근 7일 대화 맥락\n\n${contextText}\n\n`;

    if (timeSinceLastCall) {
      prompt += `# 마지막 대화 이후 경과 시간\n${timeSinceLastCall}\n\n`;
    }

    prompt += `위 맥락을 바탕으로 어르신께 드릴 따뜻하고 개인화된 인사말을 생성해주세요.

**중요**:
- 인사말만 출력하세요 (설명이나 부연 없이)
- 1-2문장으로 간결하게
- 어르신이 자연스럽게 대답할 수 있는 형태로`;

    return prompt;
  }

  private getStandardGreeting(callDirection: 'inbound' | 'outbound'): string {
    if (callDirection === 'outbound') {
      return '안녕하세요 어르신, 저 소담이에요.';
    } else {
      return '네, 여보세요. 소담입니다.';
    }
  }

  private getTimeSinceLastCall(lastCallDate: Date): string {
    const now = new Date();
    const diffMs = now.getTime() - new Date(lastCallDate).getTime();
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHours / 24);

    if (diffHours < 1) {
      return '방금 전';
    } else if (diffHours < 24) {
      return `${diffHours}시간 전`;
    } else if (diffDays === 1) {
      return '어제';
    } else if (diffDays < 7) {
      return `${diffDays}일 전`;
    } else {
      const weeks = Math.floor(diffDays / 7);
      return `${weeks}주 전`;
    }
  }
}
