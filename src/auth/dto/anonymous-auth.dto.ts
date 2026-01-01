export class AnonymousAuthDto {
  identity?: string;
  displayName?: string;
}

export class AnonymousAuthResponseDto {
  token: string;
  identity: string;
  displayName: string;
}
