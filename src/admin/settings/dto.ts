import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  Min,
  Max,
  Matches,
} from 'class-validator';

export class UpdateSettingsDto {
  // Scheduled Calls
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'preferredStartTime must be in HH:mm format',
  })
  preferredStartTime?: string;

  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'preferredEndTime must be in HH:mm format',
  })
  preferredEndTime?: string;

  // Retry Policy
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  maxRetries?: number;

  @IsOptional()
  @IsInt()
  @Min(5)
  @Max(120)
  retryInterval?: number;

  // Risk Detection
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(3)
  riskSensitivity?: number;

  // Conversation Topics
  @IsOptional()
  @IsBoolean()
  healthCheck?: boolean;

  @IsOptional()
  @IsBoolean()
  mealCheck?: boolean;

  @IsOptional()
  @IsBoolean()
  medicationCheck?: boolean;

  @IsOptional()
  @IsBoolean()
  sleepCheck?: boolean;

  @IsOptional()
  @IsBoolean()
  moodCheck?: boolean;
}

export interface SettingsResponse {
  // Scheduled Calls
  preferredStartTime: string;
  preferredEndTime: string;

  // Retry Policy
  maxRetries: number;
  retryInterval: number;

  // Risk Detection
  riskSensitivity: number;

  // Conversation Topics
  healthCheck: boolean;
  mealCheck: boolean;
  medicationCheck: boolean;
  sleepCheck: boolean;
  moodCheck: boolean;

  updatedAt: string;
}
