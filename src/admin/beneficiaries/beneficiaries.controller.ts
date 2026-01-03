import {
  Body,
  Controller,
  Delete,
  Get,
  HttpException,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Put,
  Query,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
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

class UpdateBeneficiaryDto {
  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  name?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  phoneNumber?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsDateString()
  birthDate?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  address?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  gender?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  wardType?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  guardian?: string | null;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  diseases?: string[];

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  medication?: string | null;

  @IsOptional()
  @Transform(({ value }) => (value === '' ? null : value))
  @IsString()
  notes?: string | null;
}

interface BeneficiaryListResponse {
  data: BeneficiaryListItem[];
  page: number;
  pageSize: number;
  total: number;
}

interface BeneficiaryDetailResponse {
  data: {
    id: string;
    name: string;
    email: string;
    phoneNumber: string | null;
    birthDate: string | null;
    address: string | null;
    gender: string | null;
    type: string | null;
    guardian: string | null;
    diseases: string[];
    medication: string | null;
    notes: string | null;
    recentLogs: Array<{
      id: string;
      date: string;
      type: string;
      content: string;
      sentiment?: 'positive' | 'neutral' | 'negative';
    }>;
  };
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
    const organizationId = this.getOrganizationId(admin);

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

  @Get(':id')
  async detail(
    @CurrentAdmin() admin: { organization_id?: string },
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<BeneficiaryDetailResponse> {
    const organizationId = this.getOrganizationId(admin);

    const detail = await this.dbService.getOrganizationBeneficiaryDetail({
      organizationId,
      beneficiaryId: id,
    });

    if (!detail) {
      throw new HttpException('대상자 정보를 찾을 수 없습니다.', HttpStatus.NOT_FOUND);
    }

    return { data: detail };
  }

  @Delete(':id')
  async remove(
    @CurrentAdmin() admin: { organization_id?: string },
    @Param('id', new ParseUUIDPipe()) id: string,
  ): Promise<{ success: true; message: string }> {
    const organizationId = this.getOrganizationId(admin);

    const deleted = await this.dbService.deleteOrganizationBeneficiary({
      organizationId,
      beneficiaryId: id,
    });

    if (!deleted) {
      throw new HttpException('대상자 정보를 찾을 수 없습니다.', HttpStatus.NOT_FOUND);
    }

    return { success: true, message: '대상자 정보가 삭제되었습니다.' };
  }

  @Put(':id')
  async update(
    @CurrentAdmin() admin: { organization_id?: string },
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body() body: UpdateBeneficiaryDto,
  ): Promise<BeneficiaryDetailResponse> {
    const organizationId = this.getOrganizationId(admin);

    const updated = await this.dbService.updateOrganizationBeneficiary({
      organizationId,
      beneficiaryId: id,
      data: {
        name: body.name,
        phoneNumber: body.phoneNumber,
        birthDate: body.birthDate,
        address: body.address,
        gender: body.gender,
        wardType: body.wardType,
        guardian: body.guardian,
        diseases: body.diseases,
        medication: body.medication,
        notes: body.notes,
      },
    });

    if (!updated) {
      throw new HttpException('대상자 정보를 찾을 수 없습니다.', HttpStatus.NOT_FOUND);
    }

    return { data: updated };
  }

  private getOrganizationId(admin: { organization_id?: string }): string {
    const organizationId = admin.organization_id;
    if (!organizationId) {
      throw new HttpException(
        '조직이 설정되지 않은 관리자입니다. 조직 설정 후 다시 시도해주세요.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return organizationId;
  }
}
