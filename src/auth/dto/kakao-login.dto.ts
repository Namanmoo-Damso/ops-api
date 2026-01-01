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
  matchStatus?: 'matched' | 'not_matched';
  wardInfo?: {
    phoneNumber: string;
    linkedGuardian?: {
      id: string;
      nickname: string | null;
    };
  };
}
