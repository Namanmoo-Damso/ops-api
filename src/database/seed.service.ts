/**
 * Seed Service
 * 서버 시작 시 기본 데이터 시딩
 *
 * OrganizationWard만 생성 (isRegistered=false)
 * 실제 User/Ward는 카카오 로그인 시 생성됨
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';

interface SeedWard {
  email: string;
  name: string;
  phoneNumber: string;
}

interface SeedStaff {
  email: string;
  name: string;
  phoneNumber: string;
  team: string;
  jobTitle: string;
  maxCapacity: number;
}

const SEED_ORGANIZATION_NAME = '담소 관제센터';

const SEED_WARDS: SeedWard[] = [
  { email: '1002dm@naver.com', name: '권동민', phoneNumber: '010-5029-0144' },
  { email: 'vhxmwhkd@naver.com', name: '김상연', phoneNumber: '010-9639-7703' },
  {
    email: 'seongsu0227@nate.com',
    name: '문성수',
    phoneNumber: '010-8616-6481',
  },
  {
    email: 'antjw1999@gmail.com',
    name: '배재완',
    phoneNumber: '010-7937-4563',
  },
  { email: 'kei1221@naver.com', name: '임익화', phoneNumber: '010-5919-5036' },
];

const SEED_STAFF: SeedStaff[] = [
  {
    email: 'staff1@damso.kr',
    name: '김민정',
    phoneNumber: '010-1234-5678',
    team: '방문 1팀',
    jobTitle: '팀장',
    maxCapacity: 25,
  },
  {
    email: 'staff2@damso.kr',
    name: '이서연',
    phoneNumber: '010-2345-6789',
    team: '방문 1팀',
    jobTitle: '사회복지사',
    maxCapacity: 20,
  },
  {
    email: 'staff3@damso.kr',
    name: '박준호',
    phoneNumber: '010-3456-7890',
    team: '방문 2팀',
    jobTitle: '팀장',
    maxCapacity: 25,
  },
  {
    email: 'staff4@damso.kr',
    name: '최유진',
    phoneNumber: '010-4567-8901',
    team: '방문 2팀',
    jobTitle: '사회복지사',
    maxCapacity: 20,
  },
  {
    email: 'staff5@damso.kr',
    name: '정하은',
    phoneNumber: '010-5678-9012',
    team: '방문 3팀',
    jobTitle: '사회복지사',
    maxCapacity: 20,
  },
];

const DEFAULT_ADDRESS = '경기 용인시 처인구 영문로 55';
const DEFAULT_GENDER = 'male';
const DEFAULT_BIRTH_DATE = new Date('1950-01-01');

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedDefaultWards();
    await this.seedDefaultStaff();
  }

  private async seedDefaultWards() {
    this.logger.log('기본 어르신 데이터 시딩 시작...');

    // 1. 기관 확보 (없으면 생성)
    const organization = await this.getOrCreateOrganization(
      SEED_ORGANIZATION_NAME,
    );
    this.logger.log(`기관: ${organization.name} (${organization.id})`);

    let created = 0;
    let skipped = 0;

    for (const ward of SEED_WARDS) {
      const exists = await this.prisma.organizationWard.findFirst({
        where: { organizationId: organization.id, email: ward.email },
      });

      if (exists) {
        skipped++;
        continue;
      }

      // OrganizationWard만 생성 (User/Ward는 카카오 로그인 시 생성)
      await this.prisma.organizationWard.create({
        data: {
          organizationId: organization.id,
          email: ward.email,
          phoneNumber: ward.phoneNumber,
          name: ward.name,
          birthDate: DEFAULT_BIRTH_DATE,
          address: DEFAULT_ADDRESS,
          gender: DEFAULT_GENDER,
          isRegistered: false, // 카카오 로그인 후 true로 변경
          wardId: null, // 카카오 로그인 후 연결
        },
      });
      created++;
      this.logger.log(`준비됨: ${ward.name} (${ward.email})`);
    }

    this.logger.log(
      `기본 어르신 데이터 시딩 완료 - 생성: ${created}, 스킵: ${skipped}`,
    );
  }

  private async seedDefaultStaff() {
    this.logger.log('기본 직원 데이터 시딩 시작...');

    const organization = await this.getOrCreateOrganization(
      SEED_ORGANIZATION_NAME,
    );

    let created = 0;
    let skipped = 0;

    for (const staff of SEED_STAFF) {
      const exists = await this.prisma.admin.findFirst({
        where: { email: staff.email },
      });

      if (exists) {
        skipped++;
        continue;
      }

      // Create admin with staff scheduling fields
      await this.prisma.admin.create({
        data: {
          email: staff.email,
          name: staff.name,
          provider: 'seed',
          providerId: `seed_${staff.email}`,
          role: staff.jobTitle === '팀장' ? 'org_admin' : 'viewer',
          organizationId: organization.id,
          isActive: true,
          team: staff.team,
          jobTitle: staff.jobTitle,
          phoneNumber: staff.phoneNumber,
          maxCapacity: staff.maxCapacity,
        },
      });

      created++;
      this.logger.log(
        `직원 생성됨: ${staff.name} (${staff.team} - ${staff.jobTitle})`,
      );
    }

    // Assign wards to staff (distribute evenly)
    await this.assignWardsToStaff(organization.id);

    this.logger.log(
      `기본 직원 데이터 시딩 완료 - 생성: ${created}, 스킵: ${skipped}`,
    );
  }

  private async assignWardsToStaff(organizationId: string) {
    // Get all unassigned organization wards
    const unassignedWards = await this.prisma.organizationWard.findMany({
      where: {
        organizationId,
        wardAssignments: { none: {} },
      },
    });

    if (unassignedWards.length === 0) {
      this.logger.log('배정할 대상자 없음');
      return;
    }

    // Get all staff members
    const staffMembers = await this.prisma.admin.findMany({
      where: { organizationId, isActive: true },
      include: { wardAssignments: { where: { isActive: true } } },
    });

    if (staffMembers.length === 0) {
      this.logger.log('배정 가능한 직원 없음');
      return;
    }

    // Distribute wards evenly among staff
    let staffIndex = 0;
    for (const ward of unassignedWards) {
      const staff = staffMembers[staffIndex % staffMembers.length];

      // Check if staff has capacity
      const currentAssigned = staff.wardAssignments.length;
      if (currentAssigned < staff.maxCapacity) {
        await this.prisma.wardAssignment.create({
          data: {
            adminId: staff.id,
            organizationWardId: ward.id,
            isActive: true,
          },
        });
        this.logger.log(`배정: ${ward.name} → ${staff.name}`);
      }

      staffIndex++;
    }
  }

  private async getOrCreateOrganization(name: string) {
    const existing = await this.prisma.organization.findFirst({
      where: { name },
    });

    if (existing) {
      return existing;
    }

    return this.prisma.organization.create({
      data: { name },
    });
  }
}
