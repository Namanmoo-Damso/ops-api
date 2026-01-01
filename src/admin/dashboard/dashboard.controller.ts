import {
  Controller,
  Get,
  HttpException,
  HttpStatus,
  Logger,
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
      throw new HttpException('Failed to fetch dashboard stats', HttpStatus.INTERNAL_SERVER_ERROR);
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
      throw new HttpException('Failed to fetch realtime stats', HttpStatus.INTERNAL_SERVER_ERROR);
    }
  }
}
