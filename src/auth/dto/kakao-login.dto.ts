export class KakaoLoginDto {
  kakaoAccessToken?: string;
  userType?: 'guardian' | 'ward';
}

export class KakaoLoginResponseDto {
  isNewUser: boolean;
  accessToken: string;
  refreshToken: string;
  user: {
    id: string;
    email: string | null;
    nickname: string | null;
    profileImageUrl: string | null;
    userType: 'guardian' | 'ward' | null;
  };
  requiresRegistration?: boolean;
  matchStatus?: 'matched';
  wardInfo?: {
    phoneNumber: string;
    linkedGuardian?: {
      id: string;
      nickname: string | null;
    };
    linkedOrganization?: {
      id: string;
      name: string;
    };
  };
}
