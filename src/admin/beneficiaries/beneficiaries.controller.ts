import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { DbService } from '../../database';
import { AdminOrganizationGuard, CurrentAdmin } from '../../common';
import type { BeneficiaryListItem } from '../../database/repositories/ward.repository';

class ListBeneficiariesQueryDto {
  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  riskOnly?: boolean = false;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  pageSize: number = 10;
}

interface BeneficiaryListResponse {
  data: BeneficiaryListItem[];
  page: number;
  pageSize: number;
  total: number;
}

@Controller('v1/admin/beneficiaries')
@UseGuards(AdminOrganizationGuard)
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
  }),
)
export class BeneficiariesController {
  constructor(private readonly dbService: DbService) {}

  @Get()
  async list(
    @CurrentAdmin() admin: { organization_id?: string },
    @Query() query: ListBeneficiariesQueryDto,
  ): Promise<BeneficiaryListResponse> {
    const organizationId = admin.organization_id;
    if (!organizationId) {
      throw new HttpException(
        '조직이 설정되지 않은 관리자입니다. 조직 설정 후 다시 시도해주세요.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const { search, riskOnly = false, page, pageSize } = query;

    const { data, total } = await this.dbService.listOrganizationBeneficiaries({
      organizationId,
      search,
      riskOnly,
      page,
      pageSize,
    });

    return {
      data,
      page,
      pageSize,
      total,
    };
  }
}
