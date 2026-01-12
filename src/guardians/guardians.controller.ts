import {
  Controller,
  Get,
  Post,
  Put,
  Delete,
  Body,
  Param,
  Query,
  Headers,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { GuardiansService } from './guardians.service';
import { AuthService } from '../auth';

@Controller('v1/guardian')
export class GuardiansController {
  private readonly logger = new Logger(GuardiansController.name);

  constructor(
    private readonly guardiansService: GuardiansService,
    private readonly authService: AuthService,
  ) {}

  private verifyAuthHeader(authorization: string | undefined) {
    const authHeader = authorization ?? '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : undefined;

    if (!token) {
      throw new HttpException(
        'Access token is required',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const payload = this.authService.verifyAccessToken(token);
    if (!payload) {
      throw new HttpException(
        'Invalid or expired access token',
        HttpStatus.UNAUTHORIZED,
      );
    }

    return payload;
  }

  @Get('dashboard')
  async getDashboard(
    @Headers('authorization') authorization: string | undefined,
    @Query('period') period?: string,
    @Query('ward_id') wardId?: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);
    const dashboardPeriod = ['today', 'week', 'month'].includes(period ?? '')
      ? (period as 'today' | 'week' | 'month')
      : undefined;

    try {
      return await this.guardiansService.getDashboard(payload.sub, dashboardPeriod, wardId);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`getDashboard failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to get dashboard',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('report')
  async getReport(
    @Headers('authorization') authorization: string | undefined,
    @Query('period') period?: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);
    const reportPeriod = period === 'month' ? 'month' : 'week';

    try {
      return await this.guardiansService.getReport(payload.sub, reportPeriod);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`getReport failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to get report',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('wards')
  async getWards(@Headers('authorization') authorization: string | undefined) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      return await this.guardiansService.getWards(payload.sub);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`getWards failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to get wards',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Post('wards')
  async addWard(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      wardEmail?: string;
      wardPhoneNumber?: string;
      wardBasicInfo?: {
        name?: string;
        relation?: string;
        phoneNumber?: string;
        birthDate?: string;
        gender?: string;
        address?: string;
      };
      aiCareInfo?: {
        medicalConditions?: string;
        medications?: string;
      };
      callSchedule?: {
        isEnabled: boolean;
        items: Array<{
          id?: string;
          slotStartHour: number;
          slotStartMinute: number;
          weekdays: number[];
          isEnabled: boolean;
        }>;
      };
    },
  ) {
    const payload = this.verifyAuthHeader(authorization);

    const wardEmail = body.wardEmail?.trim();
    const wardPhoneNumber = body.wardPhoneNumber?.trim();

    if (!wardEmail) {
      throw new HttpException('wardEmail is required', HttpStatus.BAD_REQUEST);
    }
    if (!wardPhoneNumber) {
      throw new HttpException(
        'wardPhoneNumber is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!wardEmail.includes('@')) {
      throw new HttpException('Invalid email format', HttpStatus.BAD_REQUEST);
    }
    if (!/^[\d-]+$/.test(wardPhoneNumber)) {
      throw new HttpException(
        'Invalid phone number format',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.guardiansService.addWard(
        payload.sub,
        wardEmail,
        wardPhoneNumber,
        {
          wardBasicInfo: body.wardBasicInfo,
          aiCareInfo: body.aiCareInfo,
          callSchedule: body.callSchedule,
        },
      );
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`addWard failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to add ward',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('wards/:wardId')
  async updateWard(
    @Headers('authorization') authorization: string | undefined,
    @Param('wardId') wardId: string,
    @Body() body: { wardEmail?: string; wardPhoneNumber?: string },
  ) {
    const payload = this.verifyAuthHeader(authorization);

    const wardEmail = body.wardEmail?.trim();
    const wardPhoneNumber = body.wardPhoneNumber?.trim();

    if (!wardEmail) {
      throw new HttpException('wardEmail is required', HttpStatus.BAD_REQUEST);
    }
    if (!wardPhoneNumber) {
      throw new HttpException(
        'wardPhoneNumber is required',
        HttpStatus.BAD_REQUEST,
      );
    }
    if (!wardEmail.includes('@')) {
      throw new HttpException('Invalid email format', HttpStatus.BAD_REQUEST);
    }
    if (!/^[\d-]+$/.test(wardPhoneNumber)) {
      throw new HttpException(
        'Invalid phone number format',
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      return await this.guardiansService.updateWard(
        payload.sub,
        wardId,
        wardEmail,
        wardPhoneNumber,
      );
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`updateWard failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to update ward',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('wards/:wardId')
  async deleteWard(
    @Headers('authorization') authorization: string | undefined,
    @Param('wardId') wardId: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      await this.guardiansService.deleteWard(payload.sub, wardId);
      return { success: true, message: '피보호자 등록이 삭제되었습니다.' };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`deleteWard failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to delete ward',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('notification-settings')
  async getNotificationSettings(
    @Headers('authorization') authorization: string | undefined,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      return await this.guardiansService.getNotificationSettings(payload.sub);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(
        'getNotificationSettings failed error=' + (error as Error).message,
      );
      throw new HttpException(
        'Failed to get notification settings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('notification-settings')
  async updateNotificationSettings(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      callReminder?: boolean;
      callComplete?: boolean;
      healthAlert?: boolean;
    },
  ) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      return await this.guardiansService.updateNotificationSettings(
        payload.sub,
        {
          callReminder: body.callReminder,
          callComplete: body.callComplete,
          healthAlert: body.healthAlert,
        },
      );
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(
        'updateNotificationSettings failed error=' + (error as Error).message,
      );
      throw new HttpException(
        'Failed to update notification settings',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('schedules')
  async getSchedules(
    @Headers('authorization') authorization: string | undefined,
    @Query('ward_id') wardId?: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      return await this.guardiansService.getSchedules(payload.sub, wardId);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`getSchedules failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to get schedules',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('schedules/availability')
  async getSlotAvailability(
    @Headers('authorization') authorization: string | undefined,
    @Query('hour') hour: string,
    @Query('minute') minute: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    const hourNum = parseInt(hour, 10);
    const minuteNum = parseInt(minute, 10);

    if (isNaN(hourNum) || hourNum < 0 || hourNum > 23) {
      throw new HttpException('Invalid hour parameter', HttpStatus.BAD_REQUEST);
    }
    if (isNaN(minuteNum) || ![0, 10, 20, 30, 40, 50].includes(minuteNum)) {
      throw new HttpException('Invalid minute parameter (must be 0, 10, 20, 30, 40, 50)', HttpStatus.BAD_REQUEST);
    }

    try {
      return await this.guardiansService.getSlotAvailability(payload.sub, hourNum, minuteNum);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(`getSlotAvailability failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to get slot availability',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Put('schedules')
  async updateSchedules(
    @Headers('authorization') authorization: string | undefined,
    @Body()
    body: {
      wardId?: string;
      isEnabled: boolean;
      items: Array<{
        id?: string;
        slotStartHour: number;
        slotStartMinute: number;
        weekdays: number[];
        isEnabled: boolean;
      }>;
    },
  ) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      return await this.guardiansService.updateSchedules(payload.sub, body);
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(
        `updateSchedules failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to update schedules',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Delete('schedules/:scheduleId')
  async deleteSchedule(
    @Headers('authorization') authorization: string | undefined,
    @Param('scheduleId') scheduleId: string,
  ) {
    const payload = this.verifyAuthHeader(authorization);

    try {
      await this.guardiansService.deleteSchedule(payload.sub, scheduleId);
      return { success: true, message: '스케줄이 삭제되었습니다.' };
    } catch (error) {
      if ((error as HttpException).getStatus?.()) {
        throw error;
      }
      this.logger.warn(
        `deleteSchedule failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to delete schedule',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
