import { IsOptional, IsString, Matches, ValidateIf } from 'class-validator';
import { Transform } from 'class-transformer';

// Time format regex: HH:mm (00:00 - 23:59)
const TIME_REGEX = /^([01]\d|2[0-3]):([0-5]\d)$/;

/**
 * DTO for updating beneficiary call schedule
 * Each day can be a time string (HH:mm) or null (no schedule)
 */
export class UpdateBeneficiaryScheduleDto {
  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @Matches(TIME_REGEX, { message: 'sunday must be in HH:mm format' })
  sunday?: string | null;

  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @Matches(TIME_REGEX, { message: 'monday must be in HH:mm format' })
  monday?: string | null;

  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @Matches(TIME_REGEX, { message: 'tuesday must be in HH:mm format' })
  tuesday?: string | null;

  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @Matches(TIME_REGEX, { message: 'wednesday must be in HH:mm format' })
  wednesday?: string | null;

  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @Matches(TIME_REGEX, { message: 'thursday must be in HH:mm format' })
  thursday?: string | null;

  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @Matches(TIME_REGEX, { message: 'friday must be in HH:mm format' })
  friday?: string | null;

  @IsOptional()
  @ValidateIf((o, v) => v !== null)
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  @Matches(TIME_REGEX, { message: 'saturday must be in HH:mm format' })
  saturday?: string | null;
}

/**
 * Schedule response with day-wise time slots
 */
export interface BeneficiaryScheduleResponse {
  beneficiaryId: string;
  schedule: {
    sunday: string | null;
    monday: string | null;
    tuesday: string | null;
    wednesday: string | null;
    thursday: string | null;
    friday: string | null;
    saturday: string | null;
  };
  organizationServiceHours: {
    startTime: string;
    endTime: string;
  };
  updatedAt: string;
}

/**
 * Day of week mapping
 * 0 = Sunday, 1 = Monday, ..., 6 = Saturday
 */
export const DAY_OF_WEEK_MAP = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
} as const;

export type DayName = keyof typeof DAY_OF_WEEK_MAP;

export const DAY_NAMES: DayName[] = [
  'sunday',
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
];
