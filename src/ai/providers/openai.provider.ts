import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AiAnalysisProvider } from '../ai.interface';
import { CallAnalysisResult, AiResponse } from '../types';

export class OpenAiProvider implements AiAnalysisProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly openai: OpenAI | null;
  private readonly model: string;

  constructor(apiKey?: string, model: string = 'gpt-4o-mini') {
    this.model = model;
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

    const systemPrompt = `당신은 어르신과 AI(다미)의 대화를 분석하는 전문가입니다.
다음 JSON 형식으로 분석 결과를 반환해주세요:
{
  "summary": "대화 요약 (2-3문장, 한국어)",
  "mood": "positive" | "neutral" | "negative",
  "moodScore": 0.0 ~ 1.0 (감정 점수, 1이 가장 긍정적),
  "tags": ["키워드1", "키워드2", ...] (최대 5개, 한국어),
  "healthKeywords": {
    "pain": 언급 횟수 (숫자) 또는 null,
    "sleep": "good" | "bad" | "mentioned" 또는 null,
    "meal": "regular" | "irregular" | "mentioned" 또는 null,
    "medication": "compliant" | "non-compliant" | "mentioned" 또는 null
  }
}`;

    try {
      const response = await this.openai.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
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
