import {
  Controller,
  Get,
  Put,
  Param,
  Body,
  Query,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '../../core/config';
import { AuthService } from '../../auth';
import { DbService } from '../../database';

@Controller('v1/admin/locations')
export class LocationsController {
  private readonly logger = new Logger(LocationsController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly dbService: DbService,
  ) {}

  @Get()
  async getLocations(
    @Headers('authorization') authorization: string | undefined,
    @Query('organizationId') organizationId?: string,
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    this.logger.log(`getLocations organizationId=${organizationId ?? 'all'}`);

    try {
      const locations =
        await this.dbService.getAllWardCurrentLocations(organizationId);

      return {
        locations: locations.map(loc => ({
          wardId: loc.ward_id,
          wardName: loc.ward_nickname || loc.ward_name || '이름 없음',
          latitude: parseFloat(loc.latitude),
          longitude: parseFloat(loc.longitude),
          accuracy: loc.accuracy ? parseFloat(loc.accuracy) : null,
          lastUpdated: loc.last_updated,
          status: loc.status,
          organizationId: loc.organization_id,
        })),
      };
    } catch (error) {
      this.logger.warn(`getLocations failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to get locations',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get(':wardId/history')
  async getLocationHistory(
    @Headers('authorization') authorization: string | undefined,
    @Param('wardId') wardId: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    if (!wardId?.trim()) {
      throw new HttpException('wardId is required', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(
      `getLocationHistory wardId=${wardId} from=${from ?? 'none'} to=${to ?? 'none'}`,
    );

    try {
      const ward = await this.dbService.findWardById(wardId);
      if (!ward) {
        throw new HttpException('Ward not found', HttpStatus.NOT_FOUND);
      }

      const history = await this.dbService.getWardLocationHistory({
        wardId,
        from: from ? new Date(from) : undefined,
        to: to ? new Date(to) : undefined,
        limit: limit ? parseInt(limit, 10) : 100,
      });

      return {
        wardId,
        history: history.map(loc => ({
          latitude: parseFloat(loc.latitude),
          longitude: parseFloat(loc.longitude),
          accuracy: loc.accuracy ? parseFloat(loc.accuracy) : null,
          timestamp: loc.recorded_at,
        })),
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(
        `getLocationHistory failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to get location history',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put(':wardId/status')
  async updateLocationStatus(
    @Headers('authorization') authorization: string | undefined,
    @Param('wardId') wardId: string,
    @Body() body: { status?: string },
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    if (!wardId?.trim()) {
      throw new HttpException('wardId is required', HttpStatus.BAD_REQUEST);
    }

    const status = body.status?.trim();
    if (!status || !['normal', 'warning', 'emergency'].includes(status)) {
      throw new HttpException(
        'status must be one of: normal, warning, emergency',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`updateLocationStatus wardId=${wardId} status=${status}`);

    try {
      const ward = await this.dbService.findWardById(wardId);
      if (!ward) {
        throw new HttpException('Ward not found', HttpStatus.NOT_FOUND);
      }

      await this.dbService.updateWardLocationStatus(
        wardId,
        status as 'normal' | 'warning' | 'emergency',
      );

      return {
        success: true,
        wardId,
        status,
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(
        `updateLocationStatus failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to update status',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
