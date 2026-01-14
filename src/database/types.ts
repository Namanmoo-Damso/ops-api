/**
 * Database Row Types
 * 모든 테이블의 Row 타입 정의
 */

export type UserType = 'guardian' | 'ward' | null;

export type UserRow = {
  id: string;
  identity: string;
  display_name: string | null;
  user_type: UserType;
  email: string | null;
  nickname: string | null;
  profile_image_url: string | null;
  kakao_id: string | null;
  created_at: string;
  updated_at: string;
};

export type GuardianRow = {
  id: string;
  user_id: string;
  ward_email: string;
  ward_phone_number: string;
  created_at: string;
  updated_at: string;
};

export type WardRow = {
  id: string;
  user_id: string;
  phone_number: string;
  guardian_id: string | null;
  organization_id: string | null;
  ai_persona: string;
  weekly_call_count: number;
  call_duration_minutes: number;
  created_at: string;
  updated_at: string;
};

export type OrganizationRow = {
  id: string;
  name: string;
  created_at: string;
};

export type RefreshTokenRow = {
  id: string;
  user_id: string;
  token_hash: string;
  expires_at: string;
  created_at: string;
};

export type GuardianWardRegistrationRow = {
  id: string;
  guardian_id: string;
  ward_email: string;
  ward_phone_number: string;
  linked_ward_id: string | null;
  created_at: string;
  updated_at: string;
};

export type DeviceRow = {
  id: string;
  user_id: string | null;
  platform: string;
  apns_token: string | null;
  voip_token: string | null;
  supports_callkit: boolean;
  env: string;
  last_seen: string;
};

export type RoomRow = {
  id: string;
  room_name: string;
  created_at: string;
};

export type RoomMemberRow = {
  identity: string;
  display_name: string | null;
  joined_at: string;
};

export type CallRow = {
  id: string;
  room_name: string;
  caller_identity: string;
  callee_identity: string;
  state: string;
  created_at: string;
  answered_at: string | null;
  ended_at: string | null;
};

export type CallSummaryRow = {
  id: string;
  call_id: string;
  ward_id: string | null;
  summary: string | null;
  mood: string | null;
  health_keywords: string[] | null;
  topics: string[] | null;
  pain_mentions: string[] | null;
  analyzed_at: string;
};

export type AdminRow = {
  id: string;
  provider: string;
  provider_id: string;
  email: string;
  name: string;
  profile_image_url: string | null;
  role: string;
  organization_id: string | null;
  is_active: boolean;
  last_login_at: string | null;
  created_at: string;
  updated_at: string;
};

export type EmergencyRow = {
  id: string;
  ward_id: string;
  type: string;
  status: string;
  latitude: number;
  longitude: number;
  address: string | null;
  notes: string | null;
  triggered_at: string;
  guardian_notified_at: string | null;
  resolved_at: string | null;
  resolved_by: string | null;
  resolution_notes: string | null;
};

export type EmergencyContactRow = {
  id: string;
  emergency_id: string;
  agency_id: string | null;
  contact_type: string;
  contact_name: string;
  phone_number: string;
  contacted_at: string | null;
  response_status: string;
  notes: string | null;
};

export type EmergencyAgencyRow = {
  id: string;
  name: string;
  type: string;
  phone_number: string;
  address: string | null;
  latitude: number;
  longitude: number;
  is_active: boolean;
};

export type WardLocationRow = {
  id: string;
  ward_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address: string | null;
  recorded_at: string;
  battery_level: number | null;
};

export type WardCurrentLocationRow = {
  id: string;
  ward_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  address: string | null;
  last_updated_at: string;
  battery_level: number | null;
  status: string;
};

export type NotificationSettingRow = {
  id: string;
  user_id: string;
  push_enabled: boolean;
  email_enabled: boolean;
  sms_enabled: boolean;
  call_reminder_enabled: boolean;
  health_alert_enabled: boolean;
  created_at: string;
  updated_at: string;
};

export type CallScheduleRow = {
  id: string;
  ward_id: string;
  day_of_week: number;
  time: string;
  is_active: boolean;
  last_reminder_sent_at: string | null;
  created_at: string;
};

export type HealthAlertRow = {
  id: string;
  ward_id: string;
  guardian_id: string;
  type: string;
  severity: string;
  message: string;
  call_summary_id: string | null;
  is_read: boolean;
  created_at: string;
};
