import {
  Controller,
  Get,
  Put,
  Body,
  UseGuards,
  Request,
  Logger,
} from '@nestjs/common';
import { AdminOrganizationGuard } from '../../common/guards/admin-organization.guard';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto';

@Controller('v1/admin/settings')
@UseGuards(AdminOrganizationGuard)
export class SettingsController {
  private readonly logger = new Logger(SettingsController.name);

  constructor(private readonly settingsService: SettingsService) {}

  /**
   * GET /v1/admin/settings
   * Get organization settings
   */
  @Get()
  async getSettings(@Request() req: any) {
    const organizationId = req.organizationId;
    return this.settingsService.getSettings(organizationId);
  }

  /**
   * PUT /v1/admin/settings
   * Update organization settings
   */
  @Put()
  async updateSettings(@Request() req: any, @Body() dto: UpdateSettingsDto) {
    const organizationId = req.organizationId;
    return this.settingsService.updateSettings(organizationId, dto);
  }
}
