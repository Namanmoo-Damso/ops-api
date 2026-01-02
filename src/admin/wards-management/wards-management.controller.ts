import {
  Controller,
  Get,
  Post,
  Body,
  HttpException,
  HttpStatus,
  Logger,
  UseGuards,
  UseInterceptors,
  UsePipes,
  UploadedFile,
  ValidationPipe,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { parse } from 'csv-parse/sync';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { DbService } from '../../database';
import { CurrentAdmin } from '../../common';
import { AdminOrganizationGuard } from '../../common/guards/admin-organization.guard';
import {
  BulkUploadWardsDto,
  CreateWardDto,
} from './dto';

@Controller('v1/admin')
@UseGuards(AdminOrganizationGuard)
@UsePipes(
  new ValidationPipe({
    whitelist: true,
    transform: true,
  }),
)
export class WardsManagementController {
  private readonly logger = new Logger(WardsManagementController.name);

  constructor(private readonly dbService: DbService) {}

  private validateWardInput(payload: Partial<CreateWardDto>) {
    const dto = plainToInstance(CreateWardDto, payload);
    const errors = validateSync(dto, { whitelist: true, forbidUnknownValues: true });

    if (errors.length > 0) {
      const constraints = errors[0].constraints;
      const [firstError] = constraints ? Object.values(constraints) : [];
      throw new Error(firstError || '잘못된 입력입니다.');
    }
  }

  @Post('wards')
  async createWard(
    @CurrentAdmin() admin: { sub: string; organization_id?: string },
    @Body() body: CreateWardDto,
  ) {
    const organizationId = body.organizationId;
    const email = body.email;
    const organization = await this.dbService.findOrganization(organizationId);
    if (!organization) {
      throw new HttpException('Organization not found', HttpStatus.NOT_FOUND);
    }

    const existing = await this.dbService.findOrganizationWard(
      organizationId,
      email,
    );
    if (existing) {
      throw new HttpException(
        'Ward already exists for this organization',
        HttpStatus.CONFLICT,
      );
    }

    const created = await this.dbService.createOrganizationWard({
      organizationId,
      email: body.email,
      phoneNumber: body.phone_number,
      name: body.name,
      birthDate: body.birth_date ?? null,
      address: body.address ?? null,
      notes: body.notes,
      uploadedByAdminId: admin.sub,
    });

    return {
      id: created.id,
      organizationId: created.organization_id,
      email: created.email,
      phoneNumber: created.phone_number,
      name: created.name,
      birthDate: created.birth_date,
      address: created.address,
      notes: created.notes,
      isRegistered: created.is_registered,
      wardId: created.ward_id,
      createdAt: created.created_at,
    };
  }

  @Post('wards/bulk-upload')
  @UseInterceptors(FileInterceptor('file'))
  async bulkUploadWards(
    @CurrentAdmin() admin: { sub: string; role?: string; organization_id?: string },
    @UploadedFile() file: Express.Multer.File,
    @Body() body: BulkUploadWardsDto,
  ) {
    const organizationId = body.organizationId;

    if (!file) {
      throw new HttpException('file is required', HttpStatus.BAD_REQUEST);
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new HttpException(
        'File size exceeds 5MB limit',
        HttpStatus.BAD_REQUEST,
      );
    }

    const organization = await this.dbService.findOrganization(organizationId);
    if (!organization) {
      throw new HttpException('Organization not found', HttpStatus.NOT_FOUND);
    }

    this.logger.log(
      `bulkUploadWards organizationId=${organizationId} adminId=${admin.sub} fileSize=${file.size}`,
    );

    try {
      const records = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<{
        email?: string;
        phone_number?: string;
        name?: string;
        birth_date?: string;
        address?: string;
        notes?: string;
      }>;

      const results = {
        total: records.length,
        created: 0,
        skipped: 0,
        failed: 0,
        errors: [] as Array<{ row: number; email: string; reason: string }>,
      };

      for (let i = 0; i < records.length; i++) {
        const record = records[i];
        const row = i + 2;
        const email = record.email?.trim() ?? '';
        const phoneNumber = record.phone_number?.trim() ?? '';
        const name = record.name?.trim() ?? '';
        const birthDate = record.birth_date?.trim() || null;
        const address = record.address?.trim() || null;
        const notes = record.notes?.trim() || undefined;

        try {
          this.validateWardInput({
            organizationId,
            email,
            phone_number: phoneNumber,
            name,
            birth_date: birthDate ?? undefined,
            address: address ?? undefined,
            notes,
          });

          const existing = await this.dbService.findOrganizationWard(
            organizationId,
            email,
          );
          if (existing) {
            results.skipped++;
            continue;
          }

          await this.dbService.createOrganizationWard({
            organizationId,
            email,
            phoneNumber,
            name,
            birthDate,
            address,
            uploadedByAdminId: admin.sub,
            notes,
          });

          results.created++;
        } catch (error) {
          results.failed++;
          results.errors.push({
            row,
            email,
            reason: (error as Error).message,
          });
        }
      }

      this.logger.log(
        `bulkUploadWards completed organizationId=${organizationId} adminId=${admin.sub} total=${results.total} created=${results.created} skipped=${results.skipped} failed=${results.failed}`,
      );

      return {
        success: true,
        ...results,
      };
    } catch (error) {
      this.logger.error(
        `bulkUploadWards failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to process CSV file',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  @Get('my-wards')
  async getMyManagedWards(
    @CurrentAdmin() admin: { sub: string },
  ) {
    const [wards, stats] = await Promise.all([
      this.dbService.getMyManagedWards(admin.sub),
      this.dbService.getMyManagedWardsStats(admin.sub),
    ]);

    return {
      wards: wards.map(w => ({
        id: w.id,
        organizationId: w.organization_id,
        organizationName: w.organization_name,
        email: w.email,
        phoneNumber: w.phone_number,
        name: w.name,
        birthDate: w.birth_date,
        address: w.address,
        notes: w.notes,
        isRegistered: w.is_registered,
        wardId: w.ward_id,
        createdAt: w.created_at,
        lastCallAt: w.last_call_at,
        totalCalls: parseInt(w.total_calls || '0', 10),
        lastMood: w.last_mood,
      })),
      stats,
    };
  }
}
