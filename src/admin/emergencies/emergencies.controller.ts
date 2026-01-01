import {
  Controller,
  Get,
  Post,
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
import { CallsService } from '../../calls';
import { DbService } from '../../database';

@Controller('v1/admin')
export class EmergenciesController {
  private readonly logger = new Logger(EmergenciesController.name);

  constructor(
    private readonly configService: ConfigService,
    private readonly authService: AuthService,
    private readonly callsService: CallsService,
    private readonly dbService: DbService,
  ) {}

  @Post('emergency')
  async triggerEmergency(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      wardId?: string;
      message?: string;
    },
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const wardId = body.wardId?.trim();
    if (!wardId) {
      throw new HttpException('wardId is required', HttpStatus.BAD_REQUEST);
    }

    try {
      const ward = await this.dbService.findWardById(wardId);
      if (!ward) {
        throw new HttpException('Ward not found', HttpStatus.NOT_FOUND);
      }

      const currentLocation = await this.dbService.getWardCurrentLocation(wardId);
      const latitude = currentLocation ? parseFloat(currentLocation.latitude) : undefined;
      const longitude = currentLocation ? parseFloat(currentLocation.longitude) : undefined;

      this.logger.log(`triggerEmergency wardId=${wardId}`);

      const emergency = await this.dbService.createEmergency({
        wardId,
        type: 'admin',
        latitude,
        longitude,
        message: body.message?.trim(),
      });

      await this.dbService.updateWardLocationStatus(wardId, 'emergency');

      const nearbyAgencies: Array<{
        id: string;
        name: string;
        type: string;
        distance: number;
        contacted: boolean;
      }> = [];

      if (latitude !== undefined && longitude !== undefined) {
        const agencies = await this.dbService.findNearbyAgencies(latitude, longitude, 10, 5);
        for (const agency of agencies) {
          const distanceKm = parseFloat(agency.distance_km);
          await this.dbService.createEmergencyContact({
            emergencyId: emergency.id,
            agencyId: agency.id,
            distanceKm,
            responseStatus: 'pending',
          });
          nearbyAgencies.push({
            id: agency.id,
            name: agency.name,
            type: agency.type,
            distance: Math.round(distanceKm * 10) / 10,
            contacted: true,
          });
        }
      }

      let guardianNotified = false;
      const wardInfo = await this.dbService.getWardWithGuardianInfo(wardId);
      if (wardInfo?.guardian_identity) {
        try {
          await this.callsService.sendUserPush({
            identity: wardInfo.guardian_identity,
            type: 'alert',
            title: '🚨 비상 알림',
            body: `관제센터에서 ${wardInfo.ward_name || '피보호자'}님에 대해 비상 상황을 발동했습니다`,
            payload: {
              type: 'emergency',
              emergencyId: emergency.id,
              wardId,
            },
          });
          await this.dbService.updateEmergencyGuardianNotified(emergency.id);
          guardianNotified = true;
        } catch (pushError) {
          this.logger.warn(`Emergency guardian push failed: ${(pushError as Error).message}`);
        }
      }

      return {
        emergencyId: emergency.id,
        status: 'dispatched',
        nearbyAgencies,
        guardianNotified,
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.error(`triggerEmergency failed error=${(error as Error).message}`);
      throw new HttpException('Failed to trigger emergency', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('emergencies')
  async getEmergencies(
    @Headers('authorization') authorization: string | undefined,
    @Query('status') status?: string,
    @Query('wardId') wardId?: string,
    @Query('limit') limit?: string,
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    const validStatuses = ['active', 'resolved', 'false_alarm'];
    if (status && !validStatuses.includes(status)) {
      throw new HttpException(
        `status must be one of: ${validStatuses.join(', ')}`,
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`getEmergencies status=${status ?? 'all'} wardId=${wardId ?? 'all'}`);

    try {
      const emergencies = await this.dbService.getEmergencies({
        status: status as 'active' | 'resolved' | 'false_alarm' | undefined,
        wardId: wardId?.trim(),
        limit: limit ? parseInt(limit, 10) : 50,
      });

      const emergenciesWithContacts = await Promise.all(
        emergencies.map(async (e) => {
          const contacts = await this.dbService.getEmergencyContacts(e.id);
          return {
            id: e.id,
            wardId: e.ward_id,
            wardName: e.ward_name || '알 수 없음',
            type: e.type,
            status: e.status,
            latitude: e.latitude ? parseFloat(e.latitude) : null,
            longitude: e.longitude ? parseFloat(e.longitude) : null,
            message: e.message,
            guardianNotified: e.guardian_notified,
            createdAt: e.created_at,
            resolvedAt: e.resolved_at,
            respondedAgencies: contacts.map((c) => c.agency_name),
          };
        }),
      );

      return {
        emergencies: emergenciesWithContacts,
      };
    } catch (error) {
      this.logger.warn(`getEmergencies failed error=${(error as Error).message}`);
      throw new HttpException('Failed to get emergencies', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Get('emergencies/:id')
  async getEmergencyDetail(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') emergencyId: string,
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    if (!emergencyId?.trim()) {
      throw new HttpException('emergencyId is required', HttpStatus.BAD_REQUEST);
    }

    this.logger.log(`getEmergencyDetail emergencyId=${emergencyId}`);

    try {
      const emergency = await this.dbService.getEmergencyById(emergencyId);
      if (!emergency) {
        throw new HttpException('Emergency not found', HttpStatus.NOT_FOUND);
      }

      const contacts = await this.dbService.getEmergencyContacts(emergencyId);

      return {
        id: emergency.id,
        wardId: emergency.ward_id,
        wardName: emergency.ward_name || '알 수 없음',
        type: emergency.type,
        status: emergency.status,
        latitude: emergency.latitude ? parseFloat(emergency.latitude) : null,
        longitude: emergency.longitude ? parseFloat(emergency.longitude) : null,
        message: emergency.message,
        guardianNotified: emergency.guardian_notified,
        resolvedAt: emergency.resolved_at,
        resolvedBy: emergency.resolved_by,
        resolutionNote: emergency.resolution_note,
        createdAt: emergency.created_at,
        contacts: contacts.map((c) => ({
          id: c.id,
          agencyId: c.agency_id,
          agencyName: c.agency_name,
          agencyType: c.agency_type,
          distanceKm: parseFloat(c.distance_km),
          responseStatus: c.response_status,
          contactedAt: c.contacted_at,
        })),
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`getEmergencyDetail failed error=${(error as Error).message}`);
      throw new HttpException('Failed to get emergency detail', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }

  @Put('emergencies/:id/resolve')
  async resolveEmergency(
    @Headers('authorization') authorization: string | undefined,
    @Param('id') emergencyId: string,
    @Body()
    body: {
      status?: 'resolved' | 'false_alarm';
      resolutionNote?: string;
    },
  ) {
    const config = this.configService.getConfig();
    const auth = this.authService.getAuthContext(authorization);
    if (config.authRequired && !auth) {
      throw new HttpException('Unauthorized', HttpStatus.UNAUTHORIZED);
    }

    if (!emergencyId?.trim()) {
      throw new HttpException('emergencyId is required', HttpStatus.BAD_REQUEST);
    }

    const resolveStatus = body.status || 'resolved';
    if (!['resolved', 'false_alarm'].includes(resolveStatus)) {
      throw new HttpException(
        'status must be one of: resolved, false_alarm',
        HttpStatus.BAD_REQUEST,
      );
    }

    this.logger.log(`resolveEmergency emergencyId=${emergencyId} status=${resolveStatus}`);

    try {
      const emergency = await this.dbService.getEmergencyById(emergencyId);
      if (!emergency) {
        throw new HttpException('Emergency not found', HttpStatus.NOT_FOUND);
      }

      if (emergency.status !== 'active') {
        throw new HttpException('Emergency is already resolved', HttpStatus.BAD_REQUEST);
      }

      const resolvedBy = auth?.identity || 'admin';
      let resolvedByUserId: string | null = null;
      try {
        const user = await this.dbService.upsertUser(resolvedBy);
        resolvedByUserId = user.id;
      } catch {
        // ignore
      }

      const resolved = await this.dbService.resolveEmergency({
        emergencyId,
        resolvedBy: resolvedByUserId || resolvedBy,
        status: resolveStatus,
        resolutionNote: body.resolutionNote?.trim(),
      });

      if (emergency.ward_id) {
        await this.dbService.updateWardLocationStatus(emergency.ward_id, 'normal');
      }

      return {
        success: true,
        emergencyId: resolved.id,
        status: resolved.status,
        resolvedAt: resolved.resolved_at,
      };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`resolveEmergency failed error=${(error as Error).message}`);
      throw new HttpException('Failed to resolve emergency', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
