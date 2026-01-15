import {
  IsString,
  IsInt,
  IsBoolean,
  IsOptional,
  Min,
  Max,
  Matches,
  ValidatorConstraint,
  ValidatorConstraintInterface,
  Validate,
  ValidationArguments,
} from 'class-validator';

@ValidatorConstraint({ name: 'isTimeRangeValid', async: false })
class IsTimeRangeValid implements ValidatorConstraintInterface {
  validate(value: any, args: ValidationArguments) {
    const dto = args.object as UpdateSettingsDto;
    // Only validate if both times are provided
    if (dto.preferredStartTime && dto.preferredEndTime) {
      return dto.preferredStartTime < dto.preferredEndTime;
    }
    return true;
  }

  defaultMessage() {
    return 'preferredStartTime must be earlier than preferredEndTime';
  }
}

export class UpdateSettingsDto {
  // Scheduled Calls
  @IsOptional()
  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'preferredStartTime must be in HH:mm format',
  })
  @Validate(IsTimeRangeValid)
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
