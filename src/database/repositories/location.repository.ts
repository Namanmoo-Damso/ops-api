/**
 * Location Repository
 * ward_locations, ward_current_locations 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { Prisma } from '../../generated/prisma';

@Injectable()
export class LocationRepository {
  constructor(private readonly prisma: PrismaService) {}

  async createWardLocation(params: {
    wardId: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    recordedAt: Date;
  }) {
    const location = await this.prisma.wardLocation.create({
      data: {
        wardId: params.wardId,
        latitude: new Prisma.Decimal(params.latitude),
        longitude: new Prisma.Decimal(params.longitude),
        accuracy: params.accuracy ? new Prisma.Decimal(params.accuracy) : null,
        recordedAt: params.recordedAt,
      },
    });
    return {
      id: location.id,
      ward_id: location.wardId,
      latitude: location.latitude.toString(),
      longitude: location.longitude.toString(),
      accuracy: location.accuracy?.toString() ?? null,
      recorded_at: location.recordedAt.toISOString(),
      created_at: location.createdAt.toISOString(),
    };
  }

  async upsertCurrentLocation(params: {
    wardId: string;
    latitude: number;
    longitude: number;
    accuracy: number | null;
    status?: 'normal' | 'warning' | 'emergency';
  }) {
    const status = params.status || 'normal';
    const location = await this.prisma.wardCurrentLocation.upsert({
      where: { wardId: params.wardId },
      update: {
        latitude: new Prisma.Decimal(params.latitude),
        longitude: new Prisma.Decimal(params.longitude),
        accuracy: params.accuracy ? new Prisma.Decimal(params.accuracy) : null,
        status,
        lastUpdated: new Date(),
      },
      create: {
        wardId: params.wardId,
        latitude: new Prisma.Decimal(params.latitude),
        longitude: new Prisma.Decimal(params.longitude),
        accuracy: params.accuracy ? new Prisma.Decimal(params.accuracy) : null,
        status,
        lastUpdated: new Date(),
      },
    });
    return {
      ward_id: location.wardId,
      latitude: location.latitude.toString(),
      longitude: location.longitude.toString(),
      accuracy: location.accuracy?.toString() ?? null,
      status: location.status,
      last_updated: location.lastUpdated.toISOString(),
    };
  }

  async getAllCurrentLocations(organizationId?: string) {
    const where: Prisma.WardCurrentLocationWhereInput = {};
    if (organizationId) {
      where.ward = { organizationId };
    }

    const locations = await this.prisma.wardCurrentLocation.findMany({
      where,
      include: {
        ward: {
          include: {
            user: { select: { displayName: true, nickname: true } },
          },
        },
      },
      orderBy: { lastUpdated: 'desc' },
    });

    return locations.map((l) => ({
      ward_id: l.wardId,
      user_id: l.ward.userId,
      ward_name: l.ward.user.displayName,
      ward_nickname: l.ward.user.nickname,
      latitude: l.latitude.toString(),
      longitude: l.longitude.toString(),
      accuracy: l.accuracy?.toString() ?? null,
      status: l.status,
      last_updated: l.lastUpdated.toISOString(),
      organization_id: l.ward.organizationId,
    }));
  }

  async getHistory(params: { wardId: string; from?: Date; to?: Date; limit?: number }) {
    const where: Prisma.WardLocationWhereInput = { wardId: params.wardId };

    if (params.from || params.to) {
      where.recordedAt = {};
      if (params.from) where.recordedAt.gte = params.from;
      if (params.to) where.recordedAt.lte = params.to;
    }

    const locations = await this.prisma.wardLocation.findMany({
      where,
      orderBy: { recordedAt: 'desc' },
      take: params.limit || 100,
    });

    return locations.map((l) => ({
      id: l.id,
      latitude: l.latitude.toString(),
      longitude: l.longitude.toString(),
      accuracy: l.accuracy?.toString() ?? null,
      recorded_at: l.recordedAt.toISOString(),
    }));
  }

  async getCurrentLocation(wardId: string) {
    const location = await this.prisma.wardCurrentLocation.findUnique({
      where: { wardId },
    });

    if (!location) return undefined;

    return {
      ward_id: location.wardId,
      latitude: location.latitude.toString(),
      longitude: location.longitude.toString(),
      accuracy: location.accuracy?.toString() ?? null,
      status: location.status,
      last_updated: location.lastUpdated.toISOString(),
    };
  }

  async updateStatus(wardId: string, status: 'normal' | 'warning' | 'emergency'): Promise<void> {
    await this.prisma.wardCurrentLocation.update({
      where: { wardId },
      data: { status, lastUpdated: new Date() },
    });
  }
}
