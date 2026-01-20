import {
  IsNumber,
  IsString,
  IsIn,
  IsObject,
  ValidateNested,
  IsOptional,
  IsUUID,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';

class CareAlertDataDto {
  @IsString()
  type: string;

  @IsObject()
  payload: Record<string, unknown>;
}

export class CreateCareAlertDto {
  @IsNumber()
  timestamp: number;

  @IsIn(['emotion', 'device_fall', 'person_fall', 'loud_voice'])
  alertType: 'emotion' | 'device_fall' | 'person_fall' | 'loud_voice';

  @IsIn(['low', 'medium', 'high', 'critical'])
  severity: 'low' | 'medium' | 'high' | 'critical';

  @IsObject()
  @ValidateNested()
  @Type(() => CareAlertDataDto)
  data: CareAlertDataDto;

  // Agent 연동 필드 (선택)
  @IsOptional()
  @IsUUID()
  callId?: string;

  @IsOptional()
  @IsString()
  roomName?: string;

  @IsOptional()
  @IsString()
  agentResponse?: string;

  @IsOptional()
  @IsIn(['ios', 'agent'])
  source?: 'ios' | 'agent';

  // Risk 분석 필드
  @IsOptional()
  @IsIn(['normal', 'caution', 'critical'])
  riskLevel?: 'normal' | 'caution' | 'critical';

  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  riskScore?: number;
}
