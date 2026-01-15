import { Injectable, Logger, HttpException, HttpStatus } from '@nestjs/common';
import { DbService } from '../../database';
import { sanitizeDiseases } from '../../common/utils/date.utils';
import { CreateWardDto } from './dto';
import { validateSync } from 'class-validator';
import { plainToInstance } from 'class-transformer';

@Injectable()
export class WardsManagementService {
  private readonly logger = new Logger(WardsManagementService.name);

  constructor(private readonly dbService: DbService) {}

  /**
   * Parse header mapping JSON string with robust error handling
   */
  parseHeaderMapping(
    mappingStr: string | undefined,
  ): Record<string, string> | null {
    if (!mappingStr || mappingStr.trim() === '') return null;
    try {
      const mapping = JSON.parse(mappingStr);
      if (typeof mapping !== 'object' || mapping === null) {
        throw new Error('Header mapping must be an object');
      }
      return mapping as Record<string, string>;
    } catch (error) {
      this.logger.error(
        `Failed to parse header mapping: ${(error as Error).message}`,
      );
      throw new HttpException(
        '헤더 매핑 정보(JSON)가 올바르지 않습니다.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  /**
   * Extract fields from a CSV record based on header mapping
   */
  private getField(
    record: Record<string, string>,
    fieldName: string,
    headerMapping: Record<string, string> | null,
  ): string | undefined {
    if (!headerMapping) return record[fieldName];
    const actualHeader = Object.keys(headerMapping).find(
      key => headerMapping[key] === fieldName,
    );
    return actualHeader ? record[actualHeader] : record[fieldName];
  }

  /**
   * Parse diseases from a string separated by commas
   */
  private parseDiseases(diseasesStr: string | undefined): string[] {
    if (!diseasesStr) return [];
    return sanitizeDiseases(diseasesStr.split(','));
  }

  /**
   * Validate a single ward record using CreateWardDto
   */
  validateWardInput(payload: Partial<CreateWardDto>) {
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
    return dto;
  }

  /**
   * Process bullk upload of wards
   */
  async processBulkUpload(
    adminId: string,
    organizationId: string,
    records: Array<Record<string, string>>,
    headerMapping: Record<string, string> | null,
  ) {
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

      const getVal = (field: string) =>
        this.getField(record, field, headerMapping)?.trim();

      const email = getVal('email') ?? '';
      const phoneNumber = getVal('phone_number') ?? '';
      const name = getVal('name') ?? '';
      const birthDate = getVal('birth_date') || null;
      const address = getVal('address') || null;
      const notes = getVal('notes') || undefined;

      try {
        const validated = this.validateWardInput({
          organizationId,
          email,
          phone_number: phoneNumber,
          name,
          birth_date: birthDate ?? undefined,
          address: address ?? undefined,
          gender: getVal('gender') || undefined,
          diseases: this.parseDiseases(getVal('diseases')),
          medication: getVal('medication') || undefined,
          emergency_contact: getVal('emergency_contact') || undefined,
          notes,
        });

        const existing = await this.dbService.findOrganizationWard(
          organizationId,
          validated.email,
        );
        if (existing) {
          results.skipped++;
          continue;
        }

        await this.dbService.createOrganizationWard({
          organizationId,
          email: validated.email,
          phoneNumber: validated.phone_number,
          name: validated.name,
          birthDate: validated.birth_date ?? null,
          address: validated.address ?? null,
          gender: validated.gender,
          diseases: validated.diseases,
          medication: validated.medication,
          emergencyContact: validated.emergency_contact,
          uploadedByAdminId: adminId,
          notes: validated.notes,
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

    return results;
  }
}
