/**
 * Admin Repository
 * admins, admin_permissions, admin_refresh_tokens, organizations 테이블 관련 메서드
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';

type AdminResult = {
  id: string;
  email: string;
  name: string | null;
  provider: string;
  provider_id: string;
  role: string;
  organization_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
};

@Injectable()
export class AdminRepository {
  constructor(private readonly prisma: PrismaService) {}

  private toAdminResult(admin: {
    id: string;
    email: string;
    name: string | null;
    provider: string;
    providerId: string;
    role: string;
    organizationId: string | null;
    isActive: boolean;
    lastLoginAt: Date | null;
    createdAt: Date;
  }): AdminResult {
    return {
      id: admin.id,
      email: admin.email,
      name: admin.name,
      provider: admin.provider,
      provider_id: admin.providerId,
      role: admin.role,
      organization_id: admin.organizationId,
      is_active: admin.isActive,
      last_login_at: admin.lastLoginAt?.toISOString() ?? null,
      created_at: admin.createdAt.toISOString(),
    };
  }

  async findByProviderId(provider: string, providerId: string): Promise<AdminResult | null> {
    const admin = await this.prisma.admin.findUnique({
      where: { provider_providerId: { provider, providerId } },
    });
    return admin ? this.toAdminResult(admin) : null;
  }

  async findByEmail(email: string): Promise<AdminResult | null> {
    const admin = await this.prisma.admin.findUnique({
      where: { email },
    });
    return admin ? this.toAdminResult(admin) : null;
  }

  async findById(adminId: string): Promise<AdminResult | null> {
    const admin = await this.prisma.admin.findUnique({
      where: { id: adminId },
    });
    return admin ? this.toAdminResult(admin) : null;
  }

  async create(params: {
    email: string;
    name?: string;
    provider: string;
    providerId: string;
    role?: string;
    organizationId?: string;
  }): Promise<{ id: string }> {
    const count = await this.prisma.admin.count();
    const isFirstAdmin = count === 0;
    const role = isFirstAdmin ? 'super_admin' : (params.role || 'admin');

    const admin = await this.prisma.admin.create({
      data: {
        email: params.email,
        name: params.name ?? null,
        provider: params.provider,
        providerId: params.providerId,
        role,
        organizationId: params.organizationId ?? null,
      },
    });
    return { id: admin.id };
  }

  async updateLastLogin(adminId: string): Promise<void> {
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { lastLoginAt: new Date() },
    });
  }

  async getPermissions(adminId: string): Promise<string[]> {
    const permissions = await this.prisma.adminPermission.findMany({
      where: { adminId },
      select: { permission: true },
    });
    return permissions.map((p) => p.permission);
  }

  async createRefreshToken(adminId: string, tokenHash: string, expiresAt: Date): Promise<{ id: string }> {
    const token = await this.prisma.adminRefreshToken.create({
      data: { adminId, tokenHash, expiresAt },
    });
    return { id: token.id };
  }

  async findRefreshToken(tokenHash: string): Promise<{
    id: string;
    admin_id: string;
    expires_at: string;
  } | null> {
    const token = await this.prisma.adminRefreshToken.findUnique({
      where: { tokenHash },
    });
    if (!token || token.expiresAt <= new Date()) return null;
    return {
      id: token.id,
      admin_id: token.adminId,
      expires_at: token.expiresAt.toISOString(),
    };
  }

  async deleteRefreshToken(tokenHash: string): Promise<void> {
    await this.prisma.adminRefreshToken.deleteMany({
      where: { tokenHash },
    });
  }

  async deleteAllRefreshTokens(adminId: string): Promise<void> {
    await this.prisma.adminRefreshToken.deleteMany({
      where: { adminId },
    });
  }

  async getAll() {
    const admins = await this.prisma.admin.findMany({
      include: {
        organization: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return admins.map((a) => ({
      ...this.toAdminResult(a),
      organization_name: a.organization?.name ?? null,
    }));
  }

  async updateRole(adminId: string, role: string, organizationId?: string): Promise<void> {
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { role, organizationId: organizationId ?? null },
    });
  }

  async updateActiveStatus(adminId: string, isActive: boolean): Promise<void> {
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { isActive },
    });
  }

  async updateOrganization(adminId: string, organizationId: string): Promise<void> {
    await this.prisma.admin.update({
      where: { id: adminId },
      data: { organizationId },
    });
  }

  // Organization methods
  async findOrganization(organizationId: string) {
    const org = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    if (!org) return undefined;
    return {
      id: org.id,
      name: org.name,
      created_at: org.createdAt.toISOString(),
    };
  }

  async listAllOrganizations() {
    const orgs = await this.prisma.organization.findMany({
      orderBy: { name: 'asc' },
    });
    return orgs.map((o) => ({
      id: o.id,
      name: o.name,
      created_at: o.createdAt.toISOString(),
    }));
  }

  async findOrCreateOrganization(name: string) {
    const existing = await this.prisma.organization.findFirst({
      where: { name },
    });

    if (existing) {
      return {
        organization: {
          id: existing.id,
          name: existing.name,
          created_at: existing.createdAt.toISOString(),
        },
        created: false,
      };
    }

    const org = await this.prisma.organization.create({
      data: { name },
    });

    return {
      organization: {
        id: org.id,
        name: org.name,
        created_at: org.createdAt.toISOString(),
      },
      created: true,
    };
  }
}
