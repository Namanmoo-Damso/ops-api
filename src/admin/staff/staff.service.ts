import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma';

export interface StaffListItem {
  id: string;
  name: string;
  email: string | null;
  phoneNumber: string | null;
  team: string | null;
  jobTitle: string | null;
  isActive: boolean;
  currentAssigned: number;
  createdAt: string;
}

export interface StaffDetail extends StaffListItem {
  organizationId: string;
  updatedAt: string;
}

export interface StaffAssignment {
  id: string;
  organizationWardId: string;
  wardName: string;
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

    const [staff, total] = await Promise.all([
      this.prisma.staff.findMany({
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
      this.prisma.staff.count({ where }),
    ]);

    const data: StaffListItem[] = staff.map(s => ({
      id: s.id,
      name: s.name,
      email: s.email,
      phoneNumber: s.phoneNumber,
      team: s.team,
      jobTitle: s.jobTitle,
      isActive: s.isActive,
      currentAssigned: s.wardAssignments.length,
      createdAt: s.createdAt.toISOString(),
    }));

    return { data, total };
  }

  async getStaffDetail(
    organizationId: string,
    staffId: string,
  ): Promise<StaffDetail | null> {
    const staff = await this.prisma.staff.findFirst({
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

    if (!staff) return null;

    return {
      id: staff.id,
      name: staff.name,
      email: staff.email,
      phoneNumber: staff.phoneNumber,
      team: staff.team,
      jobTitle: staff.jobTitle,
      isActive: staff.isActive,
      organizationId: staff.organizationId,
      currentAssigned: staff.wardAssignments.length,
      createdAt: staff.createdAt.toISOString(),
      updatedAt: staff.updatedAt.toISOString(),
    };
  }

  async createStaff(params: {
    organizationId: string;
    name: string;
    email?: string;
    phoneNumber?: string;
    team?: string;
    jobTitle?: string;
  }): Promise<{ id: string }> {
    const staff = await this.prisma.staff.create({
      data: {
        organizationId: params.organizationId,
        name: params.name,
        email: params.email,
        phoneNumber: params.phoneNumber,
        team: params.team,
        jobTitle: params.jobTitle,
        isActive: true,
      },
    });

    return { id: staff.id };
  }

  async updateStaff(
    organizationId: string,
    staffId: string,
    data: {
      name?: string;
      phoneNumber?: string;
      team?: string;
      jobTitle?: string;
      isActive?: boolean;
    },
  ): Promise<boolean> {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, organizationId },
    });

    if (!staff) return false;

    await this.prisma.staff.update({
      where: { id: staffId },
      data: {
        name: data.name,
        phoneNumber: data.phoneNumber,
        team: data.team,
        jobTitle: data.jobTitle,
        isActive: data.isActive,
      },
    });

    return true;
  }

  async deleteStaff(organizationId: string, staffId: string): Promise<boolean> {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, organizationId },
    });

    if (!staff) return false;

    // Soft delete - just deactivate
    await this.prisma.staff.update({
      where: { id: staffId },
      data: { isActive: false },
    });

    // Deactivate all assignments
    await this.prisma.wardAssignment.updateMany({
      where: { staffId: staffId },
      data: { isActive: false },
    });

    return true;
  }

  async getStaffAssignments(
    organizationId: string,
    staffId: string,
    activeOnly: boolean = true,
  ): Promise<StaffAssignment[]> {
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, organizationId },
    });

    if (!staff) return [];

    const whereClause: any = { staffId: staffId };
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
      wardPhoneNumber: a.organizationWard.phoneNumber,
      assignedAt: a.assignedAt.toISOString(),
      isActive: a.isActive,
      notes: a.notes,
    }));
  }

  async assignWard(
    organizationId: string,
    staffId: string,
    organizationWardId: string,
    notes?: string,
  ): Promise<{ id: string } | null> {
    // Verify staff belongs to organization
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, organizationId },
    });
    if (!staff) return null;

    // Verify ward belongs to organization
    const ward = await this.prisma.organizationWard.findFirst({
      where: { id: organizationWardId, organizationId },
    });
    if (!ward) return null;

    // Check if assignment exists
    const existing = await this.prisma.wardAssignment.findFirst({
      where: { staffId, organizationWardId },
    });

    if (existing) {
      // Reactivate if inactive
      if (!existing.isActive) {
        await this.prisma.wardAssignment.update({
          where: { id: existing.id },
          data: { isActive: true, notes },
        });
      }
      return { id: existing.id };
    }

    // Create new assignment
    const assignment = await this.prisma.wardAssignment.create({
      data: {
        staffId,
        organizationWardId,
        notes,
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
    const staff = await this.prisma.staff.findFirst({
      where: { id: staffId, organizationId },
    });
    if (!staff) return false;

    const assignment = await this.prisma.wardAssignment.findFirst({
      where: { id: assignmentId, staffId },
    });
    if (!assignment) return false;

    await this.prisma.wardAssignment.update({
      where: { id: assignmentId },
      data: { isActive: false },
    });

    return true;
  }

  /**
   * Reassign a beneficiary to a different staff member.
   * This deactivates the current assignment (if any) and creates a new one.
   * If newStaffId is null, only unassigns the current staff.
   */
  async reassignWard(
    organizationId: string,
    organizationWardId: string,
    newStaffId: string | null,
  ): Promise<{ success: boolean; assignmentId?: string }> {
    // Verify ward belongs to organization
    const ward = await this.prisma.organizationWard.findFirst({
      where: { id: organizationWardId, organizationId },
    });
    if (!ward) return { success: false };

    // Deactivate any existing active assignments for this ward
    await this.prisma.wardAssignment.updateMany({
      where: { organizationWardId, isActive: true },
      data: { isActive: false },
    });

    // If newStaffId is null, we're just unassigning
    if (!newStaffId) {
      return { success: true };
    }

    // Verify new staff belongs to organization
    const newStaff = await this.prisma.staff.findFirst({
      where: { id: newStaffId, organizationId },
    });
    if (!newStaff) return { success: false };

    // Create new assignment
    const assignment = await this.prisma.wardAssignment.create({
      data: {
        staffId: newStaffId,
        organizationWardId,
        isActive: true,
      },
    });

    return { success: true, assignmentId: assignment.id };
  }

  async getStaffStats(organizationId: string): Promise<StaffStats> {
    const [totalStaff, activeStaff, totalAssigned, unassignedWards] =
      await Promise.all([
        this.prisma.staff.count({ where: { organizationId } }),
        this.prisma.staff.count({ where: { organizationId, isActive: true } }),
        this.prisma.wardAssignment.count({
          where: {
            staff: { organizationId },
            isActive: true,
          },
        }),
        this.prisma.organizationWard.count({
          where: {
            organizationId,
            wardAssignments: { none: { isActive: true } },
          },
        }),
      ]);

    return {
      totalStaff,
      activeStaff,
      totalAssigned,
      avgAssigned:
        activeStaff > 0 ? Math.round(totalAssigned / activeStaff) : 0,
      unassignedWards,
    };
  }

  async getTeams(organizationId: string): Promise<string[]> {
    const staff = await this.prisma.staff.findMany({
      where: { organizationId, team: { not: null } },
      select: { team: true },
      distinct: ['team'],
    });

    return staff.map(s => s.team!).filter(Boolean);
  }

  /**
   * Create default staff from admin when organization is first accessed
   */
  async ensureDefaultStaff(
    organizationId: string,
    adminId: string,
  ): Promise<void> {
    // Check if any staff exists
    const existingStaff = await this.prisma.staff.findFirst({
      where: { organizationId },
    });

    if (existingStaff) return;

    // Get admin info
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });

    if (!admin) return;

    // Create staff from admin
    await this.prisma.staff.create({
      data: {
        organizationId,
        name: admin.name || '관리자',
        email: admin.email,
        isActive: true,
      },
    });

    this.logger.log(`Created default staff for organization ${organizationId}`);
  }

  /**
   * Get list of unassigned wards (wards without active staff assignments)
   */
  async getUnassignedWards(
    organizationId: string,
  ): Promise<{ id: string; name: string; phoneNumber: string }[]> {
    const wards = await this.prisma.organizationWard.findMany({
      where: {
        organizationId,
        wardAssignments: { none: { isActive: true } },
      },
      select: {
        id: true,
        name: true,
        phoneNumber: true,
      },
      orderBy: { name: 'asc' },
    });

    return wards.map(w => ({
      id: w.id,
      name: w.name,
      phoneNumber: w.phoneNumber,
    }));
  }
}
