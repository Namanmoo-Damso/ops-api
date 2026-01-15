import { Transform } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { IsValidPhone } from '../validators/phone-number.validator';

/**
 * Parse birthdate from YYMMDD or YYYY-MM-DD format
 * Century inference: 00-30 → 2000s, 31-99 → 1900s
 */
function parseBirthDate(value: string | undefined): string | undefined {
  if (!value || typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return undefined;

  // Already in ISO format (YYYY-MM-DD)
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;

  // YYMMDD format
  if (/^\d{6}$/.test(trimmed)) {
    const yy = parseInt(trimmed.substring(0, 2), 10);
    const mm = trimmed.substring(2, 4);
    const dd = trimmed.substring(4, 6);
    const century = yy <= 30 ? '20' : '19';
    return `${century}${trimmed.substring(0, 2)}-${mm}-${dd}`;
  }

  return trimmed; // passthrough for validation
}

export class CreateWardDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  organizationId!: string;

  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  name!: string;

  @IsEmail({}, { message: 'invalid email' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  email!: string;

  @IsString()
  @IsNotEmpty()
  @IsValidPhone()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  phone_number!: string;

  @IsOptional()
  @IsDateString()
  @Transform(({ value }) => parseBirthDate(value))
  birth_date?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined,
  )
  address?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined,
  )
  gender?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diseases?: string[];

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined,
  )
  medication?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined,
  )
  emergency_contact?: string;

  @IsOptional()
  @IsString()
  @Transform(({ value }) =>
    typeof value === 'string' && value.trim().length > 0
      ? value.trim()
      : undefined,
  )
  notes?: string;
}
