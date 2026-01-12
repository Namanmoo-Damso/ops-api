import {
  IsNumber,
  IsString,
  IsIn,
  IsObject,
  ValidateNested,
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
}
