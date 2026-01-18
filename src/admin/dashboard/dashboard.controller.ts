import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
  Query,
} from '@nestjs/common';
import { DbService } from '../../database';

@Controller('v1/admin/dashboard')
export class DashboardController {
  private readonly logger = new Logger(DashboardController.name);

  constructor(private readonly dbService: DbService) {}

  @Get('stats')
  async getStats() {
    this.logger.log('getStats called');

    try {
      const [
        overview,
        todayStats,
        weeklyTrend,
        moodDistribution,
        healthAlerts,
        topKeywords,
        organizationStats,
        recentActivity,
      ] = await Promise.all([
        this.dbService.getDashboardOverview(),
        this.dbService.getTodayStats(),
        this.dbService.getWeeklyTrend(),
        this.dbService.getMoodDistribution(),
        this.dbService.getHealthAlertsSummary(),
        this.dbService.getTopHealthKeywords(10),
        this.dbService.getOrganizationStats(),
        this.dbService.getRecentActivity(20),
      ]);

      return {
        overview,
        todayStats,
        weeklyTrend,
        moodDistribution,
        healthAlerts,
        topKeywords,
        organizationStats,
        recentActivity,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(`getStats failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to fetch dashboard stats',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get hourly call distribution for operations timeline
   * Returns scheduled, actual, and incoming call counts per hour
   */
  @Get('timeline')
  async getTimeline(@Query('date') dateParam?: string) {
    this.logger.log(`getTimeline called date=${dateParam || 'today'}`);

    try {
      // Parse date or default to today
      const targetDate = dateParam ? new Date(dateParam) : new Date();
      if (isNaN(targetDate.getTime())) {
        throw new HttpException('Invalid date format', HttpStatus.BAD_REQUEST);
      }

      const timeline =
        await this.dbService.getHourlyCallDistribution(targetDate);

      return {
        date: targetDate.toISOString().split('T')[0],
        timeline,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      if (error instanceof HttpException) throw error;
      this.logger.warn(`getTimeline failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to fetch timeline data',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get today's daily operations summary
   * Returns call counts (total/incoming/outgoing), duration stats, and check-in rates
   */
  @Get('today-summary')
  async getTodaySummary() {
    this.logger.log('getTodaySummary called');

    try {
      const summary = await this.dbService.getTodayOperationsSummary();

      return {
        ...summary,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(
        `getTodaySummary failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to fetch today summary',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  @Get('realtime')
  async getRealtime() {
    this.logger.log('getRealtime called');

    try {
      const [realtime, recentActivity] = await Promise.all([
        this.dbService.getRealtimeStats(),
        this.dbService.getRecentActivity(10),
      ]);

      return {
        ...realtime,
        recentActivity,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(`getRealtime failed error=${(error as Error).message}`);
      throw new HttpException(
        'Failed to fetch realtime stats',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get care alert logs for emergency dashboard
   * Returns recent care alerts detected during calls
   */
  @Get('care-alerts')
  async getCareAlerts(
    @Query('limit') limitParam?: string,
    @Query('hoursBack') hoursBackParam?: string,
    @Query('page') pageParam?: string,
    @Query('startDate') startDate?: string,
    @Query('endDate') endDate?: string,
  ) {
    const limit = limitParam ? parseInt(limitParam, 10) : 30;
    const hoursBack = hoursBackParam ? parseInt(hoursBackParam, 10) : 24;
    const page = pageParam ? parseInt(pageParam, 10) : 1;

    this.logger.log(
      `getCareAlerts called limit=${limit} hoursBack=${hoursBack} page=${page} startDate=${startDate} endDate=${endDate}`,
    );

    try {
      const result = await this.dbService.getCareAlertLogs(undefined, {
        limit,
        hoursBack,
        page,
        startDate,
        endDate,
      });

      return {
        ...result,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(
        `getCareAlerts failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to fetch care alerts',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }

  /**
   * Get care alert statistics
   * Returns detected vs responded count for a given period
   */
  @Get('care-alert-stats')
  async getCareAlertStats(
    @Query('period') periodParam?: 'today' | 'week' | 'month' | 'all',
  ) {
    const period = periodParam || 'today';

    this.logger.log(`getCareAlertStats called period=${period}`);

    try {
      const stats = await this.dbService.getCareAlertStats(undefined, period);

      return {
        ...stats,
        period,
        fetchedAt: new Date().toISOString(),
      };
    } catch (error) {
      this.logger.warn(
        `getCareAlertStats failed error=${(error as Error).message}`,
      );
      throw new HttpException(
        'Failed to fetch care alert stats',
        HttpStatus.INTERNAL_SERVER_ERROR,
      );
    }
  }
}
