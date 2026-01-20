import {
  Controller,
  Get,
  Post,
  Param,
  Query,
  UseGuards,
  Req,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { AdminOrganizationGuard } from '../../common/guards/admin-organization.guard';
import { NotificationsService } from './notifications.service';
import { ListNotificationsQueryDto } from './dto';

@Controller('v1/admin/notifications')
@UseGuards(AdminOrganizationGuard)
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * GET /v1/admin/notifications
   * List notifications for the organization with pagination
   */
  @Get()
  async list(@Req() req: any, @Query() query: ListNotificationsQueryDto) {
    const organizationId = req.admin?.organizationId;
    this.logger.log(`List notifications: orgId=${organizationId}, admin=${JSON.stringify(req.admin)}`);
    if (!organizationId) {
      return {
        data: [],
        pagination: { page: 1, pageSize: 10, total: 0, totalPages: 0 },
        unreadCount: 0,
      };
    }

    return this.notificationsService.list(
      organizationId,
      query.page ?? 1,
      query.pageSize ?? 10,
    );
  }

  /**
   * GET /v1/admin/notifications/unread-count
   * Get unread notification count
   */
  @Get('unread-count')
  async getUnreadCount(@Req() req: any) {
    const organizationId = req.admin?.organizationId;
    if (!organizationId) {
      return { unreadCount: 0 };
    }

    return this.notificationsService.getUnreadCount(organizationId);
  }

  /**
   * POST /v1/admin/notifications/:id/read
   * Mark a single notification as read
   */
  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  async markAsRead(@Req() req: any, @Param('id') id: string) {
    const organizationId = req.admin?.organizationId;
    if (!organizationId) {
      return { message: 'Organization not found' };
    }

    return this.notificationsService.markAsRead(id, organizationId);
  }

  /**
   * POST /v1/admin/notifications/read-all
   * Mark all notifications as read
   */
  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  async markAllAsRead(@Req() req: any) {
    const organizationId = req.admin?.organizationId;
    if (!organizationId) {
      return { message: 'Organization not found', count: 0 };
    }

    return this.notificationsService.markAllAsRead(organizationId);
  }
}
