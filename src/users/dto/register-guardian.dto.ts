export class RegisterGuardianDto {
  wardEmail?: string;
  wardPhoneNumber?: string;
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
    wardEmail: string;
    wardPhoneNumber: string;
    linkedWard: null;
  };
}
