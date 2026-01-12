export class WardBasicInfoDto {
  name?: string;
  relation?: string; // 'parent' | 'grandparent' | 'spouse' | 'relative' | 'other'
  phoneNumber?: string;
  birthDate?: string; // YYYYMMDD
  gender?: string; // 'male' | 'female'
  address?: string;
}

export class AiCareInfoDto {
  medicalConditions?: string;
  medications?: string;
}

export class CallScheduleItemDto {
  id?: string;
  time: string; // "HH:mm"
  weekdays: number[]; // [0-6], 0=일요일
  isEnabled: boolean;
}

export class CallScheduleDto {
  isEnabled: boolean;
  items: CallScheduleItemDto[];
}

export class RegisterGuardianDto {
  wardEmail?: string;
  wardPhoneNumber?: string;
  wardBasicInfo?: WardBasicInfoDto;
  aiCareInfo?: AiCareInfoDto;
  callSchedule?: CallScheduleDto;
}

export class RegisterGuardianResponseDto {
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string | null;
    nickname: string | null;
    profileImageUrl: string | null;
    userType: 'guardian';
  };
  guardianInfo: {
    id: string;
    registrationId: string;
    wardEmail: string;
    wardPhoneNumber: string;
    linkedWard: null;
  };
}
