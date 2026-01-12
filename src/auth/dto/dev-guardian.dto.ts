/**
 * 개발용 보호자 등록 DTO
 * 카카오 로그인 없이 보호자 계정 생성 + 토큰 발급
 */
export class DevGuardianDto {
  wardEmail: string;
  wardPhoneNumber: string;
  wardBasicInfo?: {
    name?: string;
    relation?: string;
    phoneNumber?: string;
    birthDate?: string;
    gender?: string;
    address?: string;
  };
  aiCareInfo?: {
    medicalConditions?: string;
    medications?: string;
  };
  callSchedule?: {
    isEnabled: boolean;
    items: Array<{
      id?: string;
      time: string;
      weekdays: number[];
      isEnabled: boolean;
    }>;
  };
  // 더미 유저 정보 (optional)
  nickname?: string;
  email?: string;
}
