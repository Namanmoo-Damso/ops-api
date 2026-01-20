import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';

export type NotificationType = 'settings_changed' | 'emergency_detected' | 'ward_linked';

export interface CreateNotificationDto {
  organizationId: string;
  type: NotificationType;
  title: string;
  message: string;
  metadata?: Record<string, any>;
}

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * List notifications for an organization with pagination
   */
  async list(organizationId: string, page = 1, pageSize = 10) {
    const pageNum = Number(page) || 1;
    const pageSizeNum = Number(pageSize) || 10;
    const skip = (pageNum - 1) * pageSizeNum;

    this.logger.log(`Fetching notifications for org=${organizationId}, page=${pageNum}, pageSize=${pageSizeNum}`);

    const [data, total, unreadCount] = await Promise.all([
      this.prisma.adminNotification.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
        skip,
        take: pageSizeNum,
      }),
      this.prisma.adminNotification.count({ where: { organizationId } }),
      this.prisma.adminNotification.count({
        where: { organizationId, isRead: false },
      }),
    ]);

    this.logger.log(`Found ${data.length} notifications, total=${total}, unread=${unreadCount}`);

    return {
      data: data.map((n) => ({
        id: n.id,
        type: n.type,
        title: n.title,
        message: n.message,
        metadata: n.metadata,
        isRead: n.isRead,
        createdAt: n.createdAt.toISOString(),
      })),
      pagination: {
        page: pageNum,
        pageSize: pageSizeNum,
        total,
        totalPages: Math.ceil(total / pageSizeNum),
      },
      unreadCount,
    };
  }

  /**
   * Get unread count for an organization
   */
  async getUnreadCount(organizationId: string) {
    const count = await this.prisma.adminNotification.count({
      where: { organizationId, isRead: false },
    });
    return { unreadCount: count };
  }

  /**
   * Mark a single notification as read
   */
  async markAsRead(id: string, organizationId: string) {
    await this.prisma.adminNotification.updateMany({
      where: { id, organizationId },
      data: { isRead: true },
    });
    return { message: 'Notification marked as read' };
  }

  /**
   * Mark all notifications as read for an organization
   */
  async markAllAsRead(organizationId: string) {
    const result = await this.prisma.adminNotification.updateMany({
      where: { organizationId, isRead: false },
      data: { isRead: true },
    });
    return { message: 'All notifications marked as read', count: result.count };
  }

  /**
   * Create a new notification
   */
  async create(data: CreateNotificationDto) {
    const notification = await this.prisma.adminNotification.create({
      data: {
        organizationId: data.organizationId,
        type: data.type,
        title: data.title,
        message: data.message,
        ...(data.metadata && { metadata: data.metadata }),
      },
    });

    this.logger.log(
      `Created notification type=${data.type} org=${data.organizationId}`,
    );

    return notification;
  }

  /**
   * Create notification for settings change
   */
  async createSettingsChangedNotification(
    organizationId: string,
    changedFields: string[],
  ) {
    return this.create({
      organizationId,
      type: 'settings_changed',
      title: '설정 변경',
      message: `기관 설정이 변경되었습니다: ${changedFields.join(', ')}`,
      metadata: { changedFields },
    });
  }

  /**
   * Create notification for emergency detection
   */
  async createEmergencyDetectedNotification(
    organizationId: string,
    emergencyId: string,
    wardName: string,
    message?: string,
  ) {
    return this.create({
      organizationId,
      type: 'emergency_detected',
      title: '🚨 위급 상황 감지',
      message: message || `${wardName}님에게 위급 상황이 감지되었습니다.`,
      metadata: { emergencyId, wardName },
    });
  }

  /**
   * Create notification for ward linking (연동 완료)
   */
  async createWardLinkedNotification(
    organizationId: string,
    wardName: string,
    organizationWardId: string,
  ) {
    return this.create({
      organizationId,
      type: 'ward_linked',
      title: '연동 완료',
      message: `${wardName}님이 앱과 연동되었습니다.`,
      metadata: { wardName, organizationWardId },
    });
  }
}
