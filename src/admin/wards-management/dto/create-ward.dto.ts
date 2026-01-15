import { Transform } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { IsValidPhone } from '../validators/phone-number.validator';
import { parseBirthDate, sanitizeDiseases } from '../../../common/utils/date.utils';

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
  @Transform(({ value }) => sanitizeDiseases(value))
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

