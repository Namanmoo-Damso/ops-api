import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class BulkUploadWardsDto {
  @IsString()
  @IsNotEmpty()
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  organizationId!: string;

  @IsOptional()
  headerMapping?: string; // JSON string of HeaderMapping
}

