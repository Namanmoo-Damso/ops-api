/**
 * Prisma to Legacy Type Mappers
 * Prisma 모델을 기존 snake_case 타입으로 변환
 */
import {
  User,
  Device,
  RefreshToken,
  Guardian,
  Call,
  CallSummary,
  Ward,
  GuardianWardRegistration,
} from '../generated/prisma';
import {
  UserRow,
  DeviceRow,
  RefreshTokenRow,
  GuardianRow,
  CallRow,
  CallSummaryRow,
  RoomMemberRow,
  WardRow,
  GuardianWardRegistrationRow,
} from './types';

export function toUserRow(user: User): UserRow {
  return {
    id: user.id,
    identity: user.identity,
    display_name: user.displayName,
    user_type: user.userType as UserRow['user_type'],
    email: user.email,
    nickname: user.nickname,
    profile_image_url: user.profileImageUrl,
    kakao_id: user.kakaoId,
    created_at: user.createdAt.toISOString(),
    updated_at: user.updatedAt.toISOString(),
  };
}

export function toDeviceRow(device: Device): DeviceRow {
  return {
    id: device.id,
    user_id: device.userId,
    platform: device.platform,
    apns_token: device.apnsToken,
    voip_token: device.voipToken,
    supports_callkit: device.supportsCallkit,
    env: device.env,
    last_seen: device.lastSeen.toISOString(),
  };
}

export function toRefreshTokenRow(token: RefreshToken): RefreshTokenRow {
  return {
    id: token.id,
    user_id: token.userId,
    token_hash: token.tokenHash,
    expires_at: token.expiresAt.toISOString(),
    created_at: token.createdAt.toISOString(),
  };
}

export function toGuardianRow(guardian: Guardian): GuardianRow {
  return {
    id: guardian.id,
    user_id: guardian.userId,
    ward_email: guardian.wardEmail,
    ward_phone_number: guardian.wardPhoneNumber,
    created_at: guardian.createdAt.toISOString(),
    updated_at: guardian.updatedAt.toISOString(),
  };
}

export function toCallRow(call: Call): CallRow {
  return {
    id: call.callId,
    room_name: call.roomName,
    caller_identity: call.callerIdentity,
    callee_identity: call.calleeIdentity,
    state: call.state,
    created_at: call.createdAt.toISOString(),
    answered_at: call.answeredAt?.toISOString() ?? null,
    ended_at: call.endedAt?.toISOString() ?? null,
  };
}

export function toCallSummaryRow(summary: CallSummary): CallSummaryRow {
  return {
    id: summary.id,
    call_id: summary.callId,
    ward_id: summary.wardId,
    summary: summary.summary,
    mood: summary.mood,
    health_keywords: summary.healthKeywords as string[] | null,
    topics: summary.tags,
    pain_mentions: null,
    analyzed_at: summary.createdAt.toISOString(),
  };
}

export function toRoomMemberRow(member: {
  identity: string;
  displayName: string | null;
  joinedAt: Date;
}): RoomMemberRow {
  return {
    identity: member.identity,
    display_name: member.displayName,
    joined_at: member.joinedAt.toISOString(),
  };
}

export function toWardRow(ward: Ward): WardRow {
  return {
    id: ward.id,
    user_id: ward.userId,
    phone_number: ward.phoneNumber,
    guardian_id: ward.guardianId,
    organization_id: ward.organizationId,
    ai_persona: ward.aiPersona ?? '다미',
    weekly_call_count: ward.weeklyCallCount,
    call_duration_minutes: ward.callDurationMinutes,
    created_at: ward.createdAt.toISOString(),
    updated_at: ward.updatedAt.toISOString(),
  };
}

export function toGuardianWardRegistrationRow(
  reg: GuardianWardRegistration,
): GuardianWardRegistrationRow {
  return {
    id: reg.id,
    guardian_id: reg.guardianId,
    ward_email: reg.wardEmail,
    ward_phone_number: reg.wardPhoneNumber,
    linked_ward_id: reg.linkedWardId,
    created_at: reg.createdAt.toISOString(),
    updated_at: reg.updatedAt.toISOString(),
  };
}
