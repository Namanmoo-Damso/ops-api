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
import { BulkUploadWardsDto, CreateWardDto, MatchCsvHeadersDto } from './dto';
import { CsvHeaderMatcherService } from './csv-header-matcher.service';

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

  constructor(
    private readonly dbService: DbService,
    private readonly csvHeaderMatcher: CsvHeaderMatcherService,
  ) { }

  private validateWardInput(payload: Partial<CreateWardDto>) {
    const dto = plainToInstance(CreateWardDto, payload);
    const errors = validateSync(dto, {
      whitelist: true,
      forbidUnknownValues: true,
    });

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
      gender: body.gender,
      diseases: body.diseases,
      medication: body.medication,
      emergencyContact: body.emergency_contact,
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
      gender: created.gender,
      diseases: created.diseases,
      medication: created.medication,
      guardian: created.emergency_contact, // Standardized as guardian
      notes: created.notes,
      isRegistered: created.is_registered,
      wardId: created.ward_id,
      createdAt: created.created_at,
    };
  }

  @Post('wards/bulk-upload')
  @UseInterceptors(FileInterceptor('file'))
  async bulkUploadWards(
    @CurrentAdmin()
    admin: { sub: string; role?: string; organization_id?: string },
    @UploadedFile() file: Express.Multer.File,
    @Body() body: BulkUploadWardsDto,
  ) {
    const organizationId = body.organizationId;
    const headerMapping = body.headerMapping
      ? (JSON.parse(body.headerMapping) as Record<string, string>)
      : null;

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
      `bulkUploadWards organizationId=${organizationId} adminId=${admin.sub} fileSize=${file.size} hasMapping=${!!headerMapping}`,
    );

    try {
      const records = parse(file.buffer, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
      }) as Array<Record<string, string>>;

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

        // Extract fields using header mapping if available
        const getField = (fieldName: string) => {
          if (!headerMapping) return record[fieldName];
          const actualHeader = Object.keys(headerMapping).find(
            key => headerMapping[key] === fieldName,
          );
          return actualHeader ? record[actualHeader] : record[fieldName];
        };

        const email = getField('email')?.trim() ?? '';
        const phoneNumber = getField('phone_number')?.trim() ?? '';
        const name = getField('name')?.trim() ?? '';
        const birthDate = getField('birth_date')?.trim() || null;
        const address = getField('address')?.trim() || null;
        const notes = getField('notes')?.trim() || undefined;

        try {
          this.validateWardInput({
            organizationId,
            email,
            phone_number: phoneNumber,
            name,
            birth_date: birthDate ?? undefined,
            address: address ?? undefined,
            gender: getField('gender')?.trim() || undefined,
            diseases:
              getField('diseases')
                ?.split(',')
                .map((s: string) => s.trim())
                .filter(Boolean) || undefined,
            medication: getField('medication')?.trim() || undefined,
            emergency_contact: getField('emergency_contact')?.trim() || undefined,
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
            gender: getField('gender')?.trim() || undefined,
            diseases: getField('diseases')
              ?.split(',')
              .map((s: string) => s.trim())
              .filter(Boolean),
            medication: getField('medication')?.trim() || undefined,
            emergencyContact: getField('emergency_contact')?.trim() || undefined,
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

  @Post('csv/match-headers')
  async matchCsvHeaders(@Body() body: MatchCsvHeadersDto) {
    const { headers } = body;

    this.logger.log(`Matching ${headers.length} CSV headers with LLM`);

    const mapping = await this.csvHeaderMatcher.matchHeaders(headers);

    return {
      success: true,
      mapping,
    };
  }

  @Get('my-wards')
  async getMyManagedWards(
    @CurrentAdmin() admin: { sub: string; organization_id?: string },
  ) {
    const organizationId = admin.organization_id;
    if (!organizationId) {
      return { wards: [], stats: { total: 0, registered: 0 } };
    }

    const [wards, stats] = await Promise.all([
      this.dbService.getOrganizationWards(organizationId),
      this.dbService.getOrganizationWardsStats(organizationId),
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
        gender: w.gender,
        diseases: w.diseases,
        medication: w.medication,
        guardian: w.emergency_contact, // Map to guardian for frontend
        isRegistered: w.is_registered,
        wardId: w.ward_id,
        createdAt: w.created_at,
        lastCallAt: w.last_call_at,
        totalCalls: parseInt(w.total_calls || '0', 10),
        lastMood: w.last_mood,
        assignedStaffId: w.assigned_staff_id,
        assignedStaffName: w.assigned_staff_name,
      })),
      stats,
    };
  }
}
