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

// 4 staff members
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
];

// 12 beneficiaries (3 per staff) + 5 real teammate accounts for testing
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
  // Staff 1's beneficiaries
  {
    email: 'ward01@example.com',
    name: '김영숙',
    phoneNumber: '010-1111-0001',
    birthDate: new Date('1948-03-15'),
    gender: 'female',
    address: '서울시 강남구 역삼동 123-45',
    diseases: ['고혈압', '당뇨'],
    notes: '매일 오전 9시 약 복용',
  },
  {
    email: 'ward02@example.com',
    name: '이순자',
    phoneNumber: '010-1111-0002',
    birthDate: new Date('1945-07-22'),
    gender: 'female',
    address: '서울시 강남구 삼성동 456-78',
    diseases: ['관절염'],
    notes: '보행 시 지팡이 사용',
  },
  {
    email: 'ward03@example.com',
    name: '박정희',
    phoneNumber: '010-1111-0003',
    birthDate: new Date('1950-11-10'),
    gender: 'male',
    address: '서울시 서초구 서초동 789-10',
    diseases: ['심장질환'],
    notes: '응급 상황 시 가족 즉시 연락',
  },
  // Staff 2's beneficiaries
  {
    email: 'ward04@example.com',
    name: '최말순',
    phoneNumber: '010-2222-0001',
    birthDate: new Date('1942-01-05'),
    gender: 'female',
    address: '서울시 송파구 잠실동 111-22',
    diseases: ['치매 초기'],
    notes: '인지 기능 저하 관찰 필요',
  },
  {
    email: 'ward05@example.com',
    name: '정복동',
    phoneNumber: '010-2222-0002',
    birthDate: new Date('1947-08-30'),
    gender: 'male',
    address: '서울시 송파구 문정동 333-44',
    diseases: ['파킨슨병'],
  },
  {
    email: 'ward06@example.com',
    name: '강옥순',
    phoneNumber: '010-2222-0003',
    birthDate: new Date('1949-05-18'),
    gender: 'female',
    address: '서울시 강동구 천호동 555-66',
    diseases: ['골다공증', '우울증'],
    notes: '정서적 지원 중요',
  },
  // Staff 3's beneficiaries
  {
    email: 'ward07@example.com',
    name: '윤기철',
    phoneNumber: '010-3333-0001',
    birthDate: new Date('1946-12-25'),
    gender: 'male',
    address: '경기도 성남시 분당구 서현동 100-1',
    diseases: ['당뇨', '백내장'],
  },
  {
    email: 'ward08@example.com',
    name: '한금자',
    phoneNumber: '010-3333-0002',
    birthDate: new Date('1944-09-12'),
    gender: 'female',
    address: '경기도 성남시 분당구 정자동 200-2',
    diseases: ['고혈압', '불면증'],
    notes: '수면 패턴 모니터링',
  },
  {
    email: 'ward09@example.com',
    name: '오병수',
    phoneNumber: '010-3333-0003',
    birthDate: new Date('1951-04-07'),
    gender: 'male',
    address: '경기도 용인시 수지구 동천동 300-3',
    diseases: ['관절염', '고지혈증'],
  },
  // Staff 4's beneficiaries
  {
    email: 'ward10@example.com',
    name: '서영희',
    phoneNumber: '010-4444-0001',
    birthDate: new Date('1948-06-20'),
    gender: 'female',
    address: '경기도 용인시 기흥구 구갈동 400-4',
    diseases: ['골절 회복 중'],
    notes: '재활 운동 필요',
  },
  {
    email: 'ward11@example.com',
    name: '장태원',
    phoneNumber: '010-4444-0002',
    birthDate: new Date('1943-02-28'),
    gender: 'male',
    address: '경기도 수원시 영통구 매탄동 500-5',
    diseases: ['심부전', '당뇨'],
    notes: '응급 상황 주의',
  },
  {
    email: 'ward12@example.com',
    name: '임춘희',
    phoneNumber: '010-4444-0003',
    birthDate: new Date('1947-10-15'),
    gender: 'female',
    address: '경기도 수원시 팔달구 인계동 600-6',
    diseases: ['위장질환'],
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
      let admin = await this.prisma.admin.findFirst({
        where: { email: staff.email },
      });

      if (!admin) {
        admin = await this.prisma.admin.create({
          data: {
            email: staff.email,
            name: staff.name,
            provider: 'seed',
            providerId: `seed_${staff.email}`,
            role: staff.jobTitle === '팀장' ? 'org_admin' : 'viewer',
            organizationId,
            isActive: true,
            team: staff.team,
            jobTitle: staff.jobTitle,
            phoneNumber: staff.phoneNumber,
            maxCapacity: staff.maxCapacity,
          },
        });
        this.logger.log(`직원 생성: ${staff.name} (${staff.team})`);
      }

      staffMembers.push({ id: admin.id, name: admin.name ?? staff.name });
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
    }> = [];

    for (const seedWard of SEED_WARDS) {
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
        });
        continue;
      }

      // Create User
      const identity = `ward_${seedWard.email.split('@')[0]}`;
      let user = await this.prisma.user.findFirst({
        where: { identity },
      });

      if (!user) {
        user = await this.prisma.user.create({
          data: {
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
            isRegistered: true,
            wardId: ward.id,
            detail: {
              create: {
                diseases: seedWard.diseases ?? [],
                notes: seedWard.notes ?? null,
              },
            },
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
          adminId: staff.id,
          organizationWardId: ward.orgWardId,
        },
      });

      if (!exists) {
        await this.prisma.wardAssignment.create({
          data: {
            adminId: staff.id,
            organizationWardId: ward.orgWardId,
            isActive: true,
          },
        });
        this.logger.log(`배정: ${ward.name} → ${staff.name}`);
      }
    }
  }

  private async generateCallLogs(
    wardRecords: Array<{ wardId: string; userId: string; name: string }>,
  ) {
    this.logger.log('통화 로그 생성...');

    const now = new Date();
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

    // Check if calls already exist for any ward
    const existingCalls = await this.prisma.call.findFirst({
      where: {
        calleeUserId: { in: wardRecords.map(w => w.userId) },
      },
    });

    if (existingCalls) {
      this.logger.log('통화 로그가 이미 존재함, 스킵');
      return;
    }

    let totalCalls = 0;

    for (const ward of wardRecords) {
      // Generate 15-25 calls per ward over the past 30 days
      const callCount = 15 + Math.floor(Math.random() * 11);

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
    staffMembers: Array<{ id: string; name: string }>,
  ) {
    const exists = await this.prisma.bulletin.findFirst({
      where: { organizationId },
    });

    if (exists) return;

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
      const authorIndex = i % staffMembers.length;
      await this.prisma.bulletin.create({
        data: {
          organizationId,
          title: bulletins[i].title,
          content: bulletins[i].content,
          authorId: staffMembers[authorIndex].id,
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
