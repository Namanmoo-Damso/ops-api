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
import { WardsManagementService } from './wards-management.service';

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
    private readonly wardsManagementService: WardsManagementService,
  ) {}

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

    if (!file) {
      throw new HttpException('file is required', HttpStatus.BAD_REQUEST);
    }

    // JSON.parse error handling is moved to service
    const headerMapping = this.wardsManagementService.parseHeaderMapping(
      body.headerMapping,
    );

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

      const results = await this.wardsManagementService.processBulkUpload(
        admin.sub,
        organizationId,
        records,
        headerMapping,
      );

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

      if (error instanceof HttpException) {
        throw error;
      }

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
