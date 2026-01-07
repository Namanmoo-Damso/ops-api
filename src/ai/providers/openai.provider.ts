import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AiAnalysisProvider } from '../ai.interface';
import { CallAnalysisResult, AiResponse } from '../types';

import { DEFAULT_SYSTEM_PROMPT } from '../ai.constants';

export class OpenAiProvider implements AiAnalysisProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly openai: OpenAI | null;
  private readonly model: string;
  private readonly maxTokens: number;
  private readonly systemPrompt: string;

  constructor(
    apiKey?: string,
    model: string = 'gpt-4o-mini',
    maxTokens: number = 1000,
    systemPrompt: string = DEFAULT_SYSTEM_PROMPT,
  ) {
    this.model = model;
    this.maxTokens = maxTokens;
    this.systemPrompt = systemPrompt;
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.logger.log('OpenAI client initialized');
    } else {
      this.openai = null;
      this.logger.warn('OPENAI_API_KEY not set, AI analysis will fail');
    }
  }

  async analyze(transcript: string): Promise<CallAnalysisResult> {
    if (!this.openai) {
      return { success: false, error: 'OpenAI API key is not configured' };
    }

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: this.systemPrompt },
          { role: 'user', content: transcript },
        ],
        response_format: { type: 'json_object' },
        max_tokens: this.maxTokens,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        return { success: false, error: 'OpenAI returned empty response' };
      }

      const result = JSON.parse(content) as AiResponse;
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
      this.logger.error(`OpenAI analysis failed: ${(error as Error).message}`);
      return { success: false, error: (error as Error).message };
    }
  }
}
