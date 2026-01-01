import {
  Controller,
  Get,
  Post,
  Body,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
  UseInterceptors,
  UploadedFile,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { parse } from 'csv-parse/sync';
import { ConfigService } from '../../core/config';
import { AuthService } from '../../auth';
import { DbService } from '../../database';

@Controller('v1/admin')
export class WardsManagementController {
  private readonly logger = new Logger(WardsManagementController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly dbService: DbService,
  ) {}

  private isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  @Post('wards/bulk-upload')
  @UseInterceptors(FileInterceptor('file'))
  async bulkUploadWards(
    @Headers('authorization') authorization: string | undefined,
    @UploadedFile() file: Express.Multer.File,
    @Body() body: { organizationId?: string },
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    let adminId: string | undefined;
    if (authorization?.startsWith('Bearer ')) {
      try {
        const tokenPayload = this.authService.verifyAdminAccessToken(authorization.slice(7));
        adminId = tokenPayload.sub;
      } catch {
        // Non-admin token, continue without admin ID
      }
    }

    if (!file) {
      throw new HttpException('file is required', HttpStatus.BAD_REQUEST);
    }

    const organizationId = body.organizationId?.trim();
    if (!organizationId) {
      throw new HttpException('organizationId is required', HttpStatus.BAD_REQUEST);
    }

    const maxSize = 5 * 1024 * 1024;
    if (file.size > maxSize) {
      throw new HttpException('File size exceeds 5MB limit', HttpStatus.BAD_REQUEST);
    }

    const organization = await this.dbService.findOrganization(organizationId);
    if (!organization) {
      throw new HttpException('Organization not found', HttpStatus.NOT_FOUND);
    }

    this.logger.log(`bulkUploadWards organizationId=${organizationId} adminId=${adminId ?? 'none'} fileSize=${file.size}`);

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

        try {
          if (!email || !this.isValidEmail(email)) {
            throw new Error('잘못된 이메일 형식');
          }
          if (!record.phone_number?.trim()) {
            throw new Error('전화번호 필수');
          }
          if (!record.name?.trim()) {
            throw new Error('이름 필수');
          }

          const existing = await this.dbService.findOrganizationWard(organizationId, email);
          if (existing) {
            results.skipped++;
            continue;
          }

          await this.dbService.createOrganizationWard({
            organizationId,
            email,
            phoneNumber: record.phone_number.trim(),
            name: record.name.trim(),
            birthDate: record.birth_date?.trim() || null,
            address: record.address?.trim() || null,
            uploadedByAdminId: adminId,
            notes: record.notes?.trim() || undefined,
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
        `bulkUploadWards completed organizationId=${organizationId} adminId=${adminId ?? 'none'} total=${results.total} created=${results.created} skipped=${results.skipped} failed=${results.failed}`,
      );

      return {
        success: true,
        ...results,
      };
    } catch (error) {
      this.logger.error(`bulkUploadWards failed error=${(error as Error).message}`);
      throw new HttpException('Failed to process CSV file', HttpStatus.BAD_REQUEST);
    }
  }

  @Get('my-wards')
  async getMyManagedWards(
    @Headers('authorization') authorization: string | undefined,
  ) {
    if (!authorization?.startsWith('Bearer ')) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const tokenPayload = this.authService.verifyAdminAccessToken(authorization.slice(7));
    const adminId = tokenPayload.sub;

    const [wards, stats] = await Promise.all([
      this.dbService.getMyManagedWards(adminId),
      this.dbService.getMyManagedWardsStats(adminId),
    ]);

    return {
      wards: wards.map((w) => ({
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
