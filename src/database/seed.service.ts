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

const SEED_ORGANIZATION_NAME = '담소 관제센터';

const SEED_WARDS: SeedWard[] = [
  { email: '1002dm@naver.com', name: '권동민', phoneNumber: '010-5029-0144' },
  { email: 'vhxmwhkd@naver.com', name: '김상연', phoneNumber: '010-9639-7703' },
  { email: 'seongsu0227@nate.com', name: '문성수', phoneNumber: '010-8616-6481' },
  { email: 'antjw1999@gmail.com', name: '배재완', phoneNumber: '010-7937-4563' },
  { email: 'kei1221@naver.com', name: '임익화', phoneNumber: '010-5919-5036' },
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
