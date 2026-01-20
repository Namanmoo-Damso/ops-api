/**
 * Seed Service
 * 서버 시작 시 기본 데이터 시딩
 *
 * Creates connected Users, Wards, OrganizationWards, Calls, CallSummaries
 * for realistic dashboard and stats display
 */
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma';

interface SeedWard {
  email: string;
  name: string;
  phoneNumber: string;
  birthDate: Date;
  gender: 'male' | 'female';
  address: string;
  diseases?: string[];
  notes?: string;
  userId?: string;
}

interface SeedStaff {
  email: string;
  name: string;
  phoneNumber: string;
  team: string;
  jobTitle: string;
}

const SEED_ORGANIZATION_NAME = '담소 관제센터';

// 4 staff members
const SEED_STAFF: SeedStaff[] = [
  {
    email: 'staff1@damso.kr',
    name: '김민정',
    phoneNumber: '010-1234-5678',
    team: '방문 1팀',
    jobTitle: '팀장',
  },
  {
    email: 'staff2@damso.kr',
    name: '이서연',
    phoneNumber: '010-2345-6789',
    team: '방문 1팀',
    jobTitle: '사회복지사',
  },
  {
    email: 'staff3@damso.kr',
    name: '박준호',
    phoneNumber: '010-3456-7890',
    team: '방문 2팀',
    jobTitle: '팀장',
  },
  {
    email: 'staff4@damso.kr',
    name: '최유진',
    phoneNumber: '010-4567-8901',
    team: '방문 2팀',
    jobTitle: '사회복지사',
  },
];

// 50 beneficiaries + 5 real teammate accounts for testing
const SEED_WARDS: SeedWard[] = [
  // Real teammate accounts for testing (preserved)
  {
    email: '1002dm@naver.com',
    name: '권동민',
    phoneNumber: '010-5029-0144',
    birthDate: new Date('1950-01-01'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
  },
  {
    email: 'vhxmwhkd@naver.com',
    name: '김상연',
    phoneNumber: '010-9639-7703',
    birthDate: new Date('1950-01-01'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
  },
  {
    email: 'seongsu0227@nate.com',
    name: '문성수',
    phoneNumber: '010-8616-6481',
    birthDate: new Date('1950-01-01'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
  },
  {
    email: 'antjw1999@gmail.com',
    name: '배재완',
    phoneNumber: '010-7937-4563',
    birthDate: new Date('1950-01-01'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
  },
  {
    email: 'kei1221@naver.com',
    name: '임익화',
    phoneNumber: '010-5919-5036',
    birthDate: new Date('1950-01-01'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
  },
  // Female wards (1-25)
  {
    email: 'ward001@example.com',
    name: '김순자',
    phoneNumber: '010-0000-0001',
    birthDate: new Date('1945-03-15'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000001',
  },
  {
    email: 'ward002@example.com',
    name: '이영희',
    phoneNumber: '010-0000-0002',
    birthDate: new Date('1948-07-22'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000002',
  },
  {
    email: 'ward003@example.com',
    name: '박정숙',
    phoneNumber: '010-0000-0003',
    birthDate: new Date('1946-11-10'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000003',
  },
  {
    email: 'ward004@example.com',
    name: '최옥순',
    phoneNumber: '010-0000-0004',
    birthDate: new Date('1944-01-05'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000004',
  },
  {
    email: 'ward005@example.com',
    name: '정말자',
    phoneNumber: '010-0000-0005',
    birthDate: new Date('1947-08-30'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000005',
  },
  {
    email: 'ward006@example.com',
    name: '강순희',
    phoneNumber: '010-0000-0006',
    birthDate: new Date('1949-05-18'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000006',
  },
  {
    email: 'ward007@example.com',
    name: '조영자',
    phoneNumber: '010-0000-0007',
    birthDate: new Date('1943-12-25'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000007',
  },
  {
    email: 'ward008@example.com',
    name: '윤정자',
    phoneNumber: '010-0000-0008',
    birthDate: new Date('1950-09-12'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000008',
  },
  {
    email: 'ward009@example.com',
    name: '장옥자',
    phoneNumber: '010-0000-0009',
    birthDate: new Date('1942-04-07'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000009',
  },
  {
    email: 'ward010@example.com',
    name: '임순옥',
    phoneNumber: '010-0000-0010',
    birthDate: new Date('1948-06-20'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000010',
  },
  {
    email: 'ward011@example.com',
    name: '한말순',
    phoneNumber: '010-0000-0011',
    birthDate: new Date('1945-02-28'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000011',
  },
  {
    email: 'ward012@example.com',
    name: '오정순',
    phoneNumber: '010-0000-0012',
    birthDate: new Date('1947-10-15'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000012',
  },
  {
    email: 'ward013@example.com',
    name: '서영순',
    phoneNumber: '010-0000-0013',
    birthDate: new Date('1946-03-22'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000013',
  },
  {
    email: 'ward014@example.com',
    name: '신순례',
    phoneNumber: '010-0000-0014',
    birthDate: new Date('1944-08-11'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000014',
  },
  {
    email: 'ward015@example.com',
    name: '권영숙',
    phoneNumber: '010-0000-0015',
    birthDate: new Date('1949-12-03'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000015',
  },
  {
    email: 'ward016@example.com',
    name: '황순덕',
    phoneNumber: '010-0000-0016',
    birthDate: new Date('1943-05-27'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000016',
  },
  {
    email: 'ward017@example.com',
    name: '안영옥',
    phoneNumber: '010-0000-0017',
    birthDate: new Date('1950-01-19'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000017',
  },
  {
    email: 'ward018@example.com',
    name: '송정숙',
    phoneNumber: '010-0000-0018',
    birthDate: new Date('1948-07-08'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000018',
  },
  {
    email: 'ward019@example.com',
    name: '전순심',
    phoneNumber: '010-0000-0019',
    birthDate: new Date('1945-11-30'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000019',
  },
  {
    email: 'ward020@example.com',
    name: '홍옥순',
    phoneNumber: '010-0000-0020',
    birthDate: new Date('1947-04-14'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000020',
  },
  {
    email: 'ward021@example.com',
    name: '유경자',
    phoneNumber: '010-0000-0021',
    birthDate: new Date('1946-09-25'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000021',
  },
  {
    email: 'ward022@example.com',
    name: '고순남',
    phoneNumber: '010-0000-0022',
    birthDate: new Date('1944-02-17'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000022',
  },
  {
    email: 'ward023@example.com',
    name: '문정옥',
    phoneNumber: '010-0000-0023',
    birthDate: new Date('1949-06-09'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000023',
  },
  {
    email: 'ward024@example.com',
    name: '양말자',
    phoneNumber: '010-0000-0024',
    birthDate: new Date('1942-10-21'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000024',
  },
  {
    email: 'ward025@example.com',
    name: '배영순',
    phoneNumber: '010-0000-0025',
    birthDate: new Date('1948-03-05'),
    gender: 'female',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000025',
  },
  // Male wards (26-50)
  {
    email: 'ward026@example.com',
    name: '김영수',
    phoneNumber: '010-0000-0026',
    birthDate: new Date('1946-07-12'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000026',
  },
  {
    email: 'ward027@example.com',
    name: '이정호',
    phoneNumber: '010-0000-0027',
    birthDate: new Date('1944-11-28'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000027',
  },
  {
    email: 'ward028@example.com',
    name: '박성철',
    phoneNumber: '010-0000-0028',
    birthDate: new Date('1947-04-03'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000028',
  },
  {
    email: 'ward029@example.com',
    name: '최만수',
    phoneNumber: '010-0000-0029',
    birthDate: new Date('1945-08-19'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000029',
  },
  {
    email: 'ward030@example.com',
    name: '정태영',
    phoneNumber: '010-0000-0030',
    birthDate: new Date('1943-12-07'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000030',
  },
  {
    email: 'ward031@example.com',
    name: '강기철',
    phoneNumber: '010-0000-0031',
    birthDate: new Date('1950-02-23'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000031',
  },
  {
    email: 'ward032@example.com',
    name: '조상호',
    phoneNumber: '010-0000-0032',
    birthDate: new Date('1948-06-15'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000032',
  },
  {
    email: 'ward033@example.com',
    name: '윤재석',
    phoneNumber: '010-0000-0033',
    birthDate: new Date('1946-10-31'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000033',
  },
  {
    email: 'ward034@example.com',
    name: '장병철',
    phoneNumber: '010-0000-0034',
    birthDate: new Date('1944-03-26'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000034',
  },
  {
    email: 'ward035@example.com',
    name: '임동수',
    phoneNumber: '010-0000-0035',
    birthDate: new Date('1949-07-18'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000035',
  },
  {
    email: 'ward036@example.com',
    name: '한상수',
    phoneNumber: '010-0000-0036',
    birthDate: new Date('1942-11-09'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000036',
  },
  {
    email: 'ward037@example.com',
    name: '오영호',
    phoneNumber: '010-0000-0037',
    birthDate: new Date('1947-05-02'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000037',
  },
  {
    email: 'ward038@example.com',
    name: '서기만',
    phoneNumber: '010-0000-0038',
    birthDate: new Date('1945-09-24'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000038',
  },
  {
    email: 'ward039@example.com',
    name: '신동철',
    phoneNumber: '010-0000-0039',
    birthDate: new Date('1943-01-16'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000039',
  },
  {
    email: 'ward040@example.com',
    name: '권정수',
    phoneNumber: '010-0000-0040',
    birthDate: new Date('1950-04-08'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000040',
  },
  {
    email: 'ward041@example.com',
    name: '황만호',
    phoneNumber: '010-0000-0041',
    birthDate: new Date('1948-08-30'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000041',
  },
  {
    email: 'ward042@example.com',
    name: '안상철',
    phoneNumber: '010-0000-0042',
    birthDate: new Date('1946-12-22'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000042',
  },
  {
    email: 'ward043@example.com',
    name: '송영석',
    phoneNumber: '010-0000-0043',
    birthDate: new Date('1944-05-14'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000043',
  },
  {
    email: 'ward044@example.com',
    name: '전기호',
    phoneNumber: '010-0000-0044',
    birthDate: new Date('1949-09-06'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000044',
  },
  {
    email: 'ward045@example.com',
    name: '홍만수',
    phoneNumber: '010-0000-0045',
    birthDate: new Date('1942-02-28'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000045',
  },
  {
    email: 'ward046@example.com',
    name: '유상호',
    phoneNumber: '010-0000-0046',
    birthDate: new Date('1947-06-20'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000046',
  },
  {
    email: 'ward047@example.com',
    name: '고영철',
    phoneNumber: '010-0000-0047',
    birthDate: new Date('1945-10-12'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000047',
  },
  {
    email: 'ward048@example.com',
    name: '문재만',
    phoneNumber: '010-0000-0048',
    birthDate: new Date('1943-03-04'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000048',
  },
  {
    email: 'ward049@example.com',
    name: '양기수',
    phoneNumber: '010-0000-0049',
    birthDate: new Date('1950-07-26'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000049',
  },
  {
    email: 'ward050@example.com',
    name: '배정호',
    phoneNumber: '010-0000-0050',
    birthDate: new Date('1948-11-18'),
    gender: 'male',
    address: '경기 용인시 처인구 영문로 55',
    userId: '10000000-0000-0000-0000-000000000050',
  },
];

// Health keywords for call summaries
const HEALTH_KEYWORDS = [
  '건강',
  '약',
  '병원',
  '가족',
  '식사',
  '수면',
  '외출',
  '통증',
  '운동',
  '혈압',
  '체온',
  '감기',
  '기침',
  '두통',
  '소화',
  '피로',
];

// Mood weights: 60% positive, 30% neutral, 10% negative
const MOOD_WEIGHTS = [0.6, 0.3, 0.1];

@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    await this.seedFullData();
  }

  private async seedFullData() {
    this.logger.log('=== 시드 데이터 생성 시작 ===');

    // 1. Get or create organization
    const organization = await this.getOrCreateOrganization(
      SEED_ORGANIZATION_NAME,
    );
    this.logger.log(`기관: ${organization.name} (${organization.id})`);

    // 2. Seed staff (4 staff members)
    const staffMembers = await this.seedStaff(organization.id);

    // 3. Seed wards with connected users
    const wardRecords = await this.seedConnectedWards(organization.id);

    // 4. Assign wards to staff (3 per staff)
    await this.assignWardsToStaff(staffMembers, wardRecords);

    // 5. Generate call logs and summaries
    await this.generateCallLogs(wardRecords);

    // 6. Seed organization settings
    await this.seedOrganizationSettings(organization.id);

    // 7. Seed sample bulletins
    await this.seedBulletins(organization.id, staffMembers);

    this.logger.log('=== 시드 데이터 생성 완료 ===');
  }

  private async seedStaff(organizationId: string) {
    this.logger.log('직원 데이터 시딩...');
    const staffMembers: Array<{ id: string; name: string }> = [];

    for (const staff of SEED_STAFF) {
      let staffRecord = await this.prisma.staff.findFirst({
        where: { organizationId, email: staff.email },
      });

      if (!staffRecord) {
        staffRecord = await this.prisma.staff.create({
          data: {
            organizationId,
            name: staff.name,
            email: staff.email,
            phoneNumber: staff.phoneNumber,
            team: staff.team,
            jobTitle: staff.jobTitle,
            isActive: true,
          },
        });
        this.logger.log(`직원 생성: ${staff.name} (${staff.team})`);
      }

      staffMembers.push({ id: staffRecord.id, name: staffRecord.name });
    }

    return staffMembers;
  }

  private async seedConnectedWards(organizationId: string) {
    this.logger.log('대상자 데이터 시딩 (연동된 사용자 포함)...');
    const wardRecords: Array<{
      wardId: string;
      userId: string;
      orgWardId: string;
      name: string;
      email: string;
    }> = [];

    for (const seedWard of SEED_WARDS) {
      // 실제 팀원 계정은 연동하지 않음 (앱에서 직접 가입해야 함)
      const isRealTeammate = !seedWard.email.endsWith('@example.com');

      if (isRealTeammate) {
        // 실제 팀원은 OrganizationWard만 생성 (wardId 없이)
        const existingOrgWard = await this.prisma.organizationWard.findFirst({
          where: { organizationId, email: seedWard.email },
        });

        if (!existingOrgWard) {
          await this.prisma.organizationWard.create({
            data: {
              organizationId,
              email: seedWard.email,
              phoneNumber: seedWard.phoneNumber,
              name: seedWard.name,
              birthDate: seedWard.birthDate,
              address: seedWard.address,
              gender: seedWard.gender,
              diseases: seedWard.diseases ?? [],
              notes: seedWard.notes ?? null,
              isRegistered: false, // 미연동 상태
              wardId: null,
            },
          });
          this.logger.log(`대상자 등록 (미연동): ${seedWard.name}`);
        }
        continue; // 다음 ward로
      }

      // Mock 유저(@example.com)는 기존 로직대로 연동
      // Check if OrganizationWard already exists
      const existingOrgWard = await this.prisma.organizationWard.findFirst({
        where: { organizationId, email: seedWard.email },
        include: { ward: true },
      });

      if (existingOrgWard && existingOrgWard.wardId) {
        // Already connected
        wardRecords.push({
          wardId: existingOrgWard.wardId,
          userId: existingOrgWard.ward!.userId,
          orgWardId: existingOrgWard.id,
          name: seedWard.name,
          email: seedWard.email,
        });
        continue;
      }

      // Create User
      const identity = `ward_${seedWard.email.split('@')[0]}`;
      let user = await this.prisma.user.findFirst({
        where: seedWard.userId ? { id: seedWard.userId } : { identity },
      });

      if (!user) {
        user = await this.prisma.user.create({
          data: {
            ...(seedWard.userId && { id: seedWard.userId }),
            identity,
            displayName: seedWard.name,
            nickname: seedWard.name,
            userType: 'ward',
            email: seedWard.email,
          },
        });
      }

      // Create Ward
      let ward = await this.prisma.ward.findFirst({
        where: { userId: user.id },
      });

      if (!ward) {
        ward = await this.prisma.ward.create({
          data: {
            userId: user.id,
            phoneNumber: seedWard.phoneNumber,
            organizationId,
            aiPersona: '다미',
            weeklyCallCount: 5,
            callDurationMinutes: 10,
          },
        });
      }

      // Create or update OrganizationWard
      let orgWardId: string;
      if (!existingOrgWard) {
        const newOrgWard = await this.prisma.organizationWard.create({
          data: {
            organizationId,
            email: seedWard.email,
            phoneNumber: seedWard.phoneNumber,
            name: seedWard.name,
            birthDate: seedWard.birthDate,
            address: seedWard.address,
            gender: seedWard.gender,
            diseases: seedWard.diseases ?? [],
            notes: seedWard.notes ?? null,
            isRegistered: true,
            wardId: ward.id,
          },
        });
        orgWardId = newOrgWard.id;
      } else {
        // Update existing OrganizationWard to link with Ward
        await this.prisma.organizationWard.update({
          where: { id: existingOrgWard.id },
          data: {
            isRegistered: true,
            wardId: ward.id,
          },
        });
        orgWardId = existingOrgWard.id;
      }

      wardRecords.push({
        wardId: ward.id,
        userId: user.id,
        orgWardId: orgWardId,
        name: seedWard.name,
        email: seedWard.email,
      });

      this.logger.log(`대상자 연동: ${seedWard.name}`);
    }

    return wardRecords;
  }

  private async assignWardsToStaff(
    staffMembers: Array<{ id: string; name: string }>,
    wardRecords: Array<{ wardId: string; orgWardId: string; name: string }>,
  ) {
    this.logger.log('대상자 배정...');

    // Distribute 3 wards per staff
    for (let i = 0; i < wardRecords.length; i++) {
      const staffIndex = Math.floor(i / 3) % staffMembers.length;
      const staff = staffMembers[staffIndex];
      const ward = wardRecords[i];

      // Check if assignment exists
      const exists = await this.prisma.wardAssignment.findFirst({
        where: {
          staffId: staff.id,
          organizationWardId: ward.orgWardId,
        },
      });

      if (!exists) {
        await this.prisma.wardAssignment.create({
          data: {
            staffId: staff.id,
            organizationWardId: ward.orgWardId,
            isActive: true,
          },
        });
        this.logger.log(`배정: ${ward.name} → ${staff.name}`);
      }
    }
  }

  private async generateCallLogs(
    wardRecords: Array<{
      wardId: string;
      userId: string;
      name: string;
      email: string;
    }>,
  ) {
    this.logger.log('통화 로그 생성...');

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Only generate mock calls for fake users (@example.com), skip real teammates
    const mockWards = wardRecords.filter(w => w.email.endsWith('@example.com'));

    if (mockWards.length === 0) {
      this.logger.log('목 대상자가 없음, 통화 로그 생성 스킵');
      return;
    }

    // Check if calls already exist for mock wards only
    const existingCalls = await this.prisma.call.findFirst({
      where: {
        calleeUserId: { in: mockWards.map(w => w.userId) },
      },
    });

    if (existingCalls) {
      this.logger.log('목 대상자 통화 로그가 이미 존재함, 스킵');
      return;
    }

    let totalCalls = 0;

    for (const ward of mockWards) {
      // Generate 15-25 calls per ward over the past 30 days
      const callCount = 3 + Math.floor(Math.random() * 11);

      for (let i = 0; i < callCount; i++) {
        // Random date within last 30 days
        const daysAgo = Math.floor(Math.random() * 30);
        const callDate = new Date(
          thirtyDaysAgo.getTime() + daysAgo * 24 * 60 * 60 * 1000,
        );

        // Random hour between 9 AM and 6 PM
        const hour = 9 + Math.floor(Math.random() * 9);
        const minute = Math.floor(Math.random() * 60);
        callDate.setHours(hour, minute, 0, 0);

        // Call duration: 3-15 minutes
        const durationMinutes = 3 + Math.floor(Math.random() * 12);
        const endedAt = new Date(
          callDate.getTime() + durationMinutes * 60 * 1000,
        );

        // Create call
        const call = await this.prisma.call.create({
          data: {
            callerIdentity: 'damso-ai',
            calleeIdentity: `ward_${ward.name}`,
            calleeUserId: ward.userId,
            roomName: `room_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            state: 'ended',
            createdAt: callDate,
            answeredAt: new Date(callDate.getTime() + 5000), // Answered after 5 seconds
            endedAt,
          },
        });

        // Create call summary
        const mood = this.getWeightedMood();
        const moodScore = this.getMoodScore(mood);
        const keywords = this.getRandomKeywords(3);

        await this.prisma.callSummary.create({
          data: {
            callId: call.callId,
            wardId: ward.wardId,
            summary: this.generateSummary(ward.name, mood, keywords),
            mood,
            moodScore,
            tags: keywords,
            healthKeywords: {
              keywords: keywords.map(k => ({ text: k, count: 1 })),
            },
            createdAt: endedAt,
          },
        });

        totalCalls++;
      }

      this.logger.log(`${ward.name}: ${callCount}건 통화 생성`);
    }

    this.logger.log(`총 ${totalCalls}건 통화 로그 생성 완료`);
  }

  private async seedOrganizationSettings(organizationId: string) {
    const exists = await this.prisma.organizationSettings.findFirst({
      where: { organizationId },
    });

    if (!exists) {
      await this.prisma.organizationSettings.create({
        data: {
          organizationId,
          preferredStartTime: '09:00',
          preferredEndTime: '18:00',
          maxRetries: 3,
          retryInterval: 30,
          riskSensitivity: 2,
          healthCheck: true,
          mealCheck: true,
          medicationCheck: true,
          sleepCheck: true,
          moodCheck: true,
        },
      });
      this.logger.log('기관 설정 생성됨');
    }
  }

  private async seedBulletins(
    organizationId: string,
    _staffMembers: Array<{ id: string; name: string }>,
  ) {
    const exists = await this.prisma.bulletin.findFirst({
      where: { organizationId },
    });

    if (exists) return;

    // Find any admin in this organization to use as author
    const admin = await this.prisma.admin.findFirst({
      where: { organizationId },
    });

    if (!admin) {
      this.logger.warn('No admin found for bulletins, skipping');
      return;
    }

    const bulletins = [
      {
        title: '1월 둘째주 안부전화 서비스 안내',
        content:
          '이번 주 안부전화 서비스가 정상적으로 운영됩니다. 특별한 주의사항이 있으신 분은 담당 직원에게 연락해 주세요.',
        isPinned: true,
      },
      {
        title: '한파 대비 어르신 안전 점검 안내',
        content:
          '한파가 예상됩니다. 어르신들의 난방 상태와 외출 자제 여부를 점검해 주세요. 응급 상황 발생 시 즉시 보고 바랍니다.',
        isPinned: false,
      },
      {
        title: '신규 직원 안내',
        content:
          '방문 2팀에 새로운 직원이 합류했습니다. 많은 협조 부탁드립니다.',
        isPinned: false,
      },
    ];

    for (let i = 0; i < bulletins.length; i++) {
      await this.prisma.bulletin.create({
        data: {
          organizationId,
          title: bulletins[i].title,
          content: bulletins[i].content,
          authorId: admin.id,
          isPinned: bulletins[i].isPinned,
          createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000), // Stagger by days
        },
      });
    }

    this.logger.log('공지사항 생성됨');
  }

  private getWeightedMood(): 'positive' | 'neutral' | 'negative' {
    const rand = Math.random();
    if (rand < MOOD_WEIGHTS[0]) return 'positive';
    if (rand < MOOD_WEIGHTS[0] + MOOD_WEIGHTS[1]) return 'neutral';
    return 'negative';
  }

  private getMoodScore(mood: string): number {
    switch (mood) {
      case 'positive':
        return 0.7 + Math.random() * 0.3; // 0.7-1.0
      case 'neutral':
        return 0.4 + Math.random() * 0.2; // 0.4-0.6
      case 'negative':
        return 0.1 + Math.random() * 0.3; // 0.1-0.4
      default:
        return 0.5;
    }
  }

  private getRandomKeywords(count: number): string[] {
    const shuffled = [...HEALTH_KEYWORDS].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, count);
  }

  private generateSummary(
    name: string,
    mood: string,
    keywords: string[],
  ): string {
    const moodText =
      mood === 'positive'
        ? '긍정적인 대화'
        : mood === 'negative'
          ? '다소 부정적인 감정'
          : '평온한 상태';

    return `${name}님과의 안부 통화. ${moodText}를 보임. 주요 언급: ${keywords.join(', ')}.`;
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
