import { Injectable, Logger } from '@nestjs/common';
import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';
import { HeaderMapping } from './dto';

@Injectable()
export class CsvHeaderMatcherService {
  private readonly logger = new Logger(CsvHeaderMatcherService.name);
  private readonly client: BedrockRuntimeClient | null;
  private readonly modelId: string;

  constructor() {
    const region = process.env.AWS_REGION;
    const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
    const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
    this.modelId = 'anthropic.claude-3-haiku-20240307-v1:0';

    if (region && accessKeyId && secretAccessKey) {
      this.client = new BedrockRuntimeClient({
        region,
        credentials: {
          accessKeyId,
          secretAccessKey,
        },
      });
      this.logger.log('Bedrock client initialized for CSV header matching');
    } else {
      this.client = null;
      this.logger.warn('AWS credentials not set, LLM-based matching will not be available');
    }
  }

  async matchHeaders(headers: string[]): Promise<HeaderMapping> {
    if (!this.client) {
      this.logger.warn('Bedrock client not available, skipping LLM matching');
      return {};
    }

    const prompt = `다음은 CSV 파일의 헤더 목록입니다:
${headers.map((h, i) => `${i + 1}. "${h}"`).join('\n')}

아래 필드 중 어떤 헤더가 어떤 필드와 매칭되는지 JSON으로 반환하세요:
- name (이름, 성명 등 - 필수)
- email (이메일 주소 - 필수)
- phone_number (전화번호, 휴대폰 등 - 필수)
- birth_date (생년월일, 생일 등 - 선택)
- address (주소, 거주지 등 - 선택)
- notes (비고, 메모 등 - 선택)

응답 형식은 반드시 아래와 같은 JSON 객체여야 합니다:
{
  "원본_헤더1": "필드명",
  "원본_헤더2": "필드명",
  ...
}

매칭되지 않는 헤더는 생략하거나 null로 설정하세요.
JSON만 반환하고 다른 텍스트는 포함하지 마세요.`;

    try {
      const payload = {
        anthropic_version: 'bedrock-2023-05-31',
        max_tokens: 500,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: prompt,
              },
            ],
          },
        ],
      };

      const command = new InvokeModelCommand({
        modelId: this.modelId,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });

      const response = await this.client.send(command);
      const responseBody = JSON.parse(new TextDecoder().decode(response.body));

      const content = responseBody.content?.[0]?.text;

      if (!content) {
        this.logger.error('Bedrock returned empty response');
        return {};
      }

      // Extract JSON from content
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.logger.error(`Failed to extract JSON from response: ${content}`);
        return {};
      }

      const mapping: HeaderMapping = JSON.parse(jsonMatch[0]);
      this.logger.log(`LLM matched ${Object.keys(mapping).length} headers`);

      return mapping;
    } catch (error) {
      this.logger.error(`LLM header matching failed: ${(error as Error).message}`);
      return {};
    }
  }
}
