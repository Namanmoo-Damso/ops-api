/**
 * Emergency Repository
 * emergencies, emergency_contacts, emergency_agencies 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { Prisma } from '@prisma/client';

type EmergencyResult = {
  id: string;
  ward_id: string;
  type: string;
  status: string;
  latitude: string | null;
  longitude: string | null;
  message: string | null;
  guardian_notified: boolean;
  created_at: string;
};

@Injectable()
export class EmergencyRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(params: {
    wardId: string;
    type: 'manual' | 'ai_detected' | 'geofence' | 'admin';
    latitude?: number;
    longitude?: number;
    message?: string;
  }): Promise<EmergencyResult> {
    const emergency = await this.prisma.emergency.create({
      data: {
        wardId: params.wardId,
        type: params.type,
        latitude: params.latitude ? new Prisma.Decimal(params.latitude) : null,
        longitude: params.longitude
          ? new Prisma.Decimal(params.longitude)
          : null,
        message: params.message ?? null,
      },
    });
    return {
      id: emergency.id,
      ward_id: emergency.wardId!,
      type: emergency.type,
      status: emergency.status,
      latitude: emergency.latitude?.toString() ?? null,
      longitude: emergency.longitude?.toString() ?? null,
      message: emergency.message,
      guardian_notified: emergency.guardianNotified,
      created_at: emergency.createdAt.toISOString(),
    };
  }

  async updateGuardianNotified(emergencyId: string): Promise<void> {
    await this.prisma.emergency.update({
      where: { id: emergencyId },
      data: { guardianNotified: true },
    });
  }

  async findNearbyAgencies(
    latitude: number,
    longitude: number,
    radiusKm: number = 5,
    limit: number = 5,
  ) {
    // Use raw query for haversine formula
    const result = await this.prisma.$queryRaw<
      Array<{
        id: string;
        name: string;
        type: string;
        phone_number: string;
        latitude: Prisma.Decimal;
        longitude: Prisma.Decimal;
        address: string | null;
        distance_km: number;
      }>
    >`
      SELECT
        id, name, type, phone_number, latitude, longitude, address,
        (
          6371 * acos(
            cos(radians(${latitude})) * cos(radians(latitude::float)) *
            cos(radians(longitude::float) - radians(${longitude})) +
            sin(radians(${latitude})) * sin(radians(latitude::float))
          )
        ) as distance_km
      FROM emergency_agencies
      WHERE is_active = true
      HAVING (
        6371 * acos(
          cos(radians(${latitude})) * cos(radians(latitude::float)) *
          cos(radians(longitude::float) - radians(${longitude})) +
          sin(radians(${latitude})) * sin(radians(latitude::float))
        )
      ) <= ${radiusKm}
      ORDER BY distance_km
      LIMIT ${limit}
    `;

    return result.map(r => ({
      id: r.id,
      name: r.name,
      type: r.type,
      phone_number: r.phone_number,
      latitude: r.latitude.toString(),
      longitude: r.longitude.toString(),
      address: r.address,
      distance_km: r.distance_km.toString(),
    }));
  }

  async createContact(params: {
    emergencyId: string;
    agencyId: string;
    distanceKm: number;
    responseStatus?: 'pending' | 'answered' | 'dispatched' | 'failed';
  }) {
    const status = params.responseStatus || 'pending';
    const contact = await this.prisma.emergencyContact.create({
      data: {
        emergencyId: params.emergencyId,
        agencyId: params.agencyId,
        distanceKm: new Prisma.Decimal(params.distanceKm),
        responseStatus: status,
      },
    });
    return {
      id: contact.id,
      emergency_id: contact.emergencyId,
      agency_id: contact.agencyId,
      distance_km: contact.distanceKm?.toString() ?? null,
      response_status: contact.responseStatus,
      contacted_at: contact.contactedAt.toISOString(),
    };
  }

  async getById(emergencyId: string) {
    const emergency = await this.prisma.emergency.findUnique({
      where: { id: emergencyId },
      include: {
        ward: {
          include: {
            user: { select: { nickname: true } },
          },
        },
      },
    });

    if (!emergency) return undefined;

    return {
      id: emergency.id,
      ward_id: emergency.wardId,
      type: emergency.type,
      status: emergency.status,
      latitude: emergency.latitude?.toString() ?? null,
      longitude: emergency.longitude?.toString() ?? null,
      message: emergency.message,
      guardian_notified: emergency.guardianNotified,
      resolved_at: emergency.resolvedAt?.toISOString() ?? null,
      resolved_by: emergency.resolvedById,
      resolution_note: emergency.resolutionNote,
      created_at: emergency.createdAt.toISOString(),
      ward_name: emergency.ward?.user.nickname ?? null,
      ward_user_id: emergency.ward?.userId ?? null,
    };
  }

  async getList(params: {
    status?: 'active' | 'resolved' | 'false_alarm';
    wardId?: string;
    limit?: number;
  }) {
    const where: Prisma.EmergencyWhereInput = {};
    if (params.status) where.status = params.status;
    if (params.wardId) where.wardId = params.wardId;

    const emergencies = await this.prisma.emergency.findMany({
      where,
      include: {
        ward: {
          include: {
            user: { select: { nickname: true, displayName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: params.limit || 50,
    });

    return emergencies.map(e => ({
      id: e.id,
      ward_id: e.wardId,
      type: e.type,
      status: e.status,
      latitude: e.latitude?.toString() ?? null,
      longitude: e.longitude?.toString() ?? null,
      message: e.message,
      guardian_notified: e.guardianNotified,
      created_at: e.createdAt.toISOString(),
      resolved_at: e.resolvedAt?.toISOString() ?? null,
      ward_name: e.ward?.user.nickname ?? e.ward?.user.displayName ?? null,
    }));
  }

  async getContacts(emergencyId: string) {
    const contacts = await this.prisma.emergencyContact.findMany({
      where: { emergencyId },
      include: {
        agency: { select: { name: true, type: true } },
      },
      orderBy: { distanceKm: 'asc' },
    });

    return contacts.map(c => ({
      id: c.id,
      agency_id: c.agencyId,
      agency_name: c.agency?.name ?? '',
      agency_type: c.agency?.type ?? '',
      distance_km: c.distanceKm?.toString() ?? '0',
      response_status: c.responseStatus,
      contacted_at: c.contactedAt.toISOString(),
    }));
  }

  async resolve(params: {
    emergencyId: string;
    resolvedBy: string;
    status: 'resolved' | 'false_alarm';
    resolutionNote?: string;
  }) {
    const emergency = await this.prisma.emergency.update({
      where: { id: params.emergencyId },
      data: {
        status: params.status,
        resolvedAt: new Date(),
        resolvedById: params.resolvedBy,
        resolutionNote: params.resolutionNote ?? null,
      },
    });
    return {
      id: emergency.id,
      status: emergency.status,
      resolved_at: emergency.resolvedAt?.toISOString() ?? null,
      resolved_by: emergency.resolvedById,
      resolution_note: emergency.resolutionNote,
    };
  }
}
