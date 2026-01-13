import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';

export interface StaffListItem {
  id: string;
  email: string;
  name: string | null;
  phoneNumber: string | null;
  team: string | null;
  jobTitle: string | null;
  maxCapacity: number;
  isActive: boolean;
  currentAssigned: number;
  createdAt: string;
}

export interface StaffDetail extends StaffListItem {
  role: string;
  organizationId: string | null;
  lastLoginAt: string | null;
  updatedAt: string;
}

export interface StaffAssignment {
  id: string;
  organizationWardId: string;
  wardName: string;
  wardEmail: string;
  wardPhoneNumber: string;
  assignedAt: string;
  isActive: boolean;
  notes: string | null;
}

export interface StaffStats {
  totalStaff: number;
  activeStaff: number;
  totalAssigned: number;
  avgAssigned: number;
  unassignedWards: number;
}

@Injectable()
export class StaffService {
  private readonly logger = new Logger(StaffService.name);

  constructor(private readonly prisma: PrismaService) {}

  async listStaff(params: {
    organizationId: string;
    search?: string;
    team?: string;
    page: number;
    pageSize: number;
  }): Promise<{ data: StaffListItem[]; total: number }> {
    const { organizationId, search, team, page, pageSize } = params;
    const skip = (page - 1) * pageSize;

    const where: any = {
      organizationId,
    };

    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (team) {
      where.team = team;
    }

    const [admins, total] = await Promise.all([
      this.prisma.admin.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: [{ team: 'asc' }, { name: 'asc' }],
        include: {
          wardAssignments: {
            where: { isActive: true },
            select: { id: true },
          },
        },
      }),
      this.prisma.admin.count({ where }),
    ]);

    const data: StaffListItem[] = admins.map(admin => ({
      id: admin.id,
      email: admin.email,
      name: admin.name,
      phoneNumber: admin.phoneNumber,
      team: admin.team,
      jobTitle: admin.jobTitle,
      maxCapacity: admin.maxCapacity,
      isActive: admin.isActive,
      currentAssigned: admin.wardAssignments.length,
      createdAt: admin.createdAt.toISOString(),
    }));

    return { data, total };
  }

  async getStaffDetail(
    organizationId: string,
    staffId: string,
  ): Promise<StaffDetail | null> {
    const admin = await this.prisma.admin.findFirst({
      where: {
        id: staffId,
        organizationId,
      },
      include: {
        wardAssignments: {
          where: { isActive: true },
          select: { id: true },
        },
      },
    });

    if (!admin) return null;

    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      phoneNumber: admin.phoneNumber,
      team: admin.team,
      jobTitle: admin.jobTitle,
      maxCapacity: admin.maxCapacity,
      isActive: admin.isActive,
      role: admin.role,
      organizationId: admin.organizationId,
      currentAssigned: admin.wardAssignments.length,
      lastLoginAt: admin.lastLoginAt?.toISOString() ?? null,
      createdAt: admin.createdAt.toISOString(),
      updatedAt: admin.updatedAt.toISOString(),
    };
  }

  async createStaff(params: {
    organizationId: string;
    email: string;
    name: string;
    phoneNumber?: string;
    team?: string;
    jobTitle?: string;
    maxCapacity?: number;
  }): Promise<{ id: string }> {
    const admin = await this.prisma.admin.create({
      data: {
        email: params.email,
        name: params.name,
        provider: 'manual',
        providerId: `manual_${params.email}`,
        role: 'viewer',
        organizationId: params.organizationId,
        isActive: true,
        phoneNumber: params.phoneNumber,
        team: params.team,
        jobTitle: params.jobTitle,
        maxCapacity: params.maxCapacity ?? 20,
      },
    });

    return { id: admin.id };
  }

  async updateStaff(
    organizationId: string,
    staffId: string,
    data: {
      name?: string;
      phoneNumber?: string;
      team?: string;
      jobTitle?: string;
      maxCapacity?: number;
      isActive?: boolean;
    },
  ): Promise<boolean> {
    const admin = await this.prisma.admin.findFirst({
      where: { id: staffId, organizationId },
    });

    if (!admin) return false;

    await this.prisma.admin.update({
      where: { id: staffId },
      data: {
        name: data.name,
        phoneNumber: data.phoneNumber,
        team: data.team,
        jobTitle: data.jobTitle,
        maxCapacity: data.maxCapacity,
        isActive: data.isActive,
      },
    });

    return true;
  }

  async deleteStaff(organizationId: string, staffId: string): Promise<boolean> {
    const admin = await this.prisma.admin.findFirst({
      where: { id: staffId, organizationId },
    });

    if (!admin) return false;

    // Soft delete - just deactivate
    await this.prisma.admin.update({
      where: { id: staffId },
      data: { isActive: false },
    });

    // Deactivate all assignments
    await this.prisma.wardAssignment.updateMany({
      where: { adminId: staffId },
      data: { isActive: false },
    });

    return true;
  }

  async getStaffAssignments(
    organizationId: string,
    staffId: string,
    activeOnly: boolean = true,
  ): Promise<StaffAssignment[]> {
    const admin = await this.prisma.admin.findFirst({
      where: { id: staffId, organizationId },
    });

    if (!admin) return [];

    const whereClause: any = { adminId: staffId };
    if (activeOnly) {
      whereClause.isActive = true;
    }

    const assignments = await this.prisma.wardAssignment.findMany({
      where: whereClause,
      include: {
        organizationWard: {
          select: {
            id: true,
            name: true,
            email: true,
            phoneNumber: true,
          },
        },
      },
      orderBy: { assignedAt: 'desc' },
    });

    return assignments.map(a => ({
      id: a.id,
      organizationWardId: a.organizationWardId,
      wardName: a.organizationWard.name,
      wardEmail: a.organizationWard.email,
      wardPhoneNumber: a.organizationWard.phoneNumber,
      assignedAt: a.assignedAt.toISOString(),
      isActive: a.isActive,
      notes: a.notes,
    }));
  }

  async assignWard(params: {
    organizationId: string;
    staffId: string;
    organizationWardId: string;
    assignedById?: string;
    notes?: string;
  }): Promise<{ id: string } | null> {
    // Verify staff belongs to organization
    const admin = await this.prisma.admin.findFirst({
      where: { id: params.staffId, organizationId: params.organizationId },
    });
    if (!admin) return null;

    // Verify ward belongs to organization
    const ward = await this.prisma.organizationWard.findFirst({
      where: {
        id: params.organizationWardId,
        organizationId: params.organizationId,
      },
    });
    if (!ward) return null;

    // Check if assignment already exists
    const existing = await this.prisma.wardAssignment.findFirst({
      where: {
        adminId: params.staffId,
        organizationWardId: params.organizationWardId,
      },
    });

    if (existing) {
      // Reactivate if inactive
      if (!existing.isActive) {
        await this.prisma.wardAssignment.update({
          where: { id: existing.id },
          data: { isActive: true, notes: params.notes },
        });
      }
      return { id: existing.id };
    }

    const assignment = await this.prisma.wardAssignment.create({
      data: {
        adminId: params.staffId,
        organizationWardId: params.organizationWardId,
        assignedById: params.assignedById,
        notes: params.notes,
        isActive: true,
      },
    });

    return { id: assignment.id };
  }

  async unassignWard(
    organizationId: string,
    staffId: string,
    assignmentId: string,
  ): Promise<boolean> {
    const admin = await this.prisma.admin.findFirst({
      where: { id: staffId, organizationId },
    });
    if (!admin) return false;

    const assignment = await this.prisma.wardAssignment.findFirst({
      where: { id: assignmentId, adminId: staffId },
    });
    if (!assignment) return false;

    await this.prisma.wardAssignment.update({
      where: { id: assignmentId },
      data: { isActive: false },
    });

    return true;
  }

  async getStaffStats(organizationId: string): Promise<StaffStats> {
    const [staffStats, unassignedCount] = await Promise.all([
      this.prisma.admin.findMany({
        where: { organizationId },
        include: {
          wardAssignments: {
            where: { isActive: true },
            select: { id: true },
          },
        },
      }),
      this.prisma.organizationWard.count({
        where: {
          organizationId,
          wardAssignments: { none: {} },
        },
      }),
    ]);

    const totalStaff = staffStats.length;
    const activeStaff = staffStats.filter(s => s.isActive).length;
    const totalAssigned = staffStats.reduce(
      (sum, s) => sum + s.wardAssignments.length,
      0,
    );
    const avgAssigned = activeStaff > 0 ? totalAssigned / activeStaff : 0;

    return {
      totalStaff,
      activeStaff,
      totalAssigned,
      avgAssigned: Math.round(avgAssigned * 10) / 10,
      unassignedWards: unassignedCount,
    };
  }

  async getTeams(organizationId: string): Promise<string[]> {
    const result = await this.prisma.admin.findMany({
      where: {
        organizationId,
        team: { not: null },
      },
      select: { team: true },
      distinct: ['team'],
    });

    return result
      .map(r => r.team)
      .filter((t): t is string => t !== null)
      .sort();
  }
}
