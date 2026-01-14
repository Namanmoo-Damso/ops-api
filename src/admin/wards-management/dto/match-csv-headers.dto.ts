import { IsArray, IsString } from 'class-validator';

export class MatchCsvHeadersDto {
  @IsArray()
  @IsString({ each: true })
  headers: string[];
}

export interface HeaderMapping {
  [originalHeader: string]: string | null;
}
