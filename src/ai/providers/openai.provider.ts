import { Logger } from '@nestjs/common';
import OpenAI from 'openai';
import { AiAnalysisProvider } from '../ai.interface';
import { CallAnalysisResult } from '../types';

export class OpenAiProvider implements AiAnalysisProvider {
  private readonly logger = new Logger(OpenAiProvider.name);
  private readonly openai: OpenAI | null;

  constructor(apiKey?: string) {
    if (apiKey) {
      this.openai = new OpenAI({ apiKey });
      this.logger.log('OpenAI client initialized');
    } else {
      this.openai = null;
      this.logger.warn(
        'OPENAI_API_KEY not set, AI analysis will use mock data',
      );
    }
  }

  async analyze(transcript: string): Promise<CallAnalysisResult> {
    if (!this.openai) {
      return this.getMockAnalysis();
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
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: transcript || '(대화 내용 없음)' },
        ],
        response_format: { type: 'json_object' },
        max_tokens: 1000,
      });

      const content = response.choices[0]?.message?.content;
      if (!content) {
        this.logger.warn('OpenAI returned empty response, using mock data');
        return this.getMockAnalysis();
      }

      const result = JSON.parse(content) as CallAnalysisResult;
      return {
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
      return this.getMockAnalysis();
    }
  }

  private getMockAnalysis(): CallAnalysisResult {
    return {
      summary:
        '어르신께서 오늘 날씨가 좋다고 말씀하시며 즐거워하셨습니다. 손주들 이야기를 하시며 웃으셨고, 건강 상태는 양호해 보입니다.',
      mood: 'positive',
      moodScore: 0.85,
      tags: ['날씨', '손주', '긍정적'],
      healthKeywords: {
        pain: null,
        sleep: 'good',
        meal: 'regular',
        medication: null,
      },
    };
  }
}
