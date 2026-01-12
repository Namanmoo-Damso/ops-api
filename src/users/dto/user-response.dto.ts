export class UserResponseDto {
  id: string;
  email: string | null;
  nickname: string | null;
  profileImageUrl: string | null;
  userType: 'guardian' | 'ward' | null;
  createdAt: string;
  guardianInfo?: {
    id: string;
    registrationId: string | null;
    wardEmail: string | null;
    wardPhoneNumber: string | null;
    linkedWard: {
      id: string;
      nickname: string | null;
      profileImageUrl: string | null;
    } | null;
  } | null;
  wardInfo?: {
    id: string;
    phoneNumber: string;
    linkedGuardian: {
      id: string;
      nickname: string | null;
      profileImageUrl: string | null;
    } | null;
    linkedOrganization: {
      id: string;
      name: string;
    } | null;
  } | null;
}

export class DeleteUserResponseDto {
  success: boolean;
  message: string;
}
