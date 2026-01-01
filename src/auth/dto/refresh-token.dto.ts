export class RefreshTokenDto {
  refreshToken?: string;
}

export class RefreshTokenResponseDto {
  accessToken: string;
  refreshToken: string;
}
