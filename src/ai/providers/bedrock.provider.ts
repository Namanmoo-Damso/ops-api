import { Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { AiAnalysisProvider } from '../ai.interface';
import { CallAnalysisResult, AiResponse } from '../types';

import { DEFAULT_SYSTEM_PROMPT } from '../ai.constants';

export class BedrockProvider implements AiAnalysisProvider {
  private readonly logger = new Logger(BedrockProvider.name);
  private readonly client: BedrockRuntimeClient | null;
  private readonly modelId: string;
  private readonly maxTokens: number;
  private readonly systemPrompt: string;

  constructor(
    region?: string,
    accessKeyId?: string,
    secretAccessKey?: string,
    modelId: string = 'anthropic.claude-3-haiku-20240307-v1:0',
    maxTokens: number = 1000,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  ) {
    this.modelId = modelId;
    this.maxTokens = maxTokens;
    this.systemPrompt = systemPrompt;
    if (region && accessKeyId && secretAccessKey) {
      this.client = new BedrockRuntimeClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log('Bedrock client initialized');
    } else {
      this.client = null;
      this.logger.warn('AWS credentials not set, AI analysis will fail');
    }
  }

  async analyze(transcript: string): Promise<CallAnalysisResult> {
    if (!this.client) {
      return { success: false, error: 'AWS credentials are not configured' };
    }

    const payload = {
      anthropic_version: 'bedrock-2023-05-31',
      max_tokens: this.maxTokens,
      system: this.systemPrompt,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: transcript,
            },
          ],
        },
      ],
    };

    try {
      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      const content = responseBody.content?.[0]?.text;

      if (!content) {
        return { success: false, error: 'Bedrock returned empty response' };
      }

      // Extract JSON from content if it contains other text
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      const jsonString = jsonMatch ? jsonMatch[0] : content;

      const result = JSON.parse(jsonString) as AiResponse;

      return {
        success: true,
        summary: result.summary || '',
        mood: result.mood || 'neutral',
        moodScore: Math.max(0, Math.min(1, result.moodScore || 0.5)),
        tags: Array.isArray(result.tags) ? result.tags.slice(0, 5) : [],
        healthKeywords: {
          pain: result.healthKeywords?.pain ?? null,
          sleep: result.healthKeywords?.sleep ?? null,
          meal: result.healthKeywords?.meal ?? null,
          medication: result.healthKeywords?.medication ?? null,
        },
      };
    } catch (error) {
      this.logger.error(`Bedrock analysis failed: ${(error as Error).message}`);
      return { success: false, error: (error as Error).message };
    }
  }
}
