-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "identity" TEXT NOT NULL,
    "display_name" TEXT,
    "user_type" TEXT,
    "email" TEXT,
    "nickname" TEXT,
    "profile_image_url" TEXT,
    "kakao_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "devices" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID,
    "platform" TEXT NOT NULL,
    "apns_token" TEXT,
    "voip_token" TEXT,
    "supports_callkit" BOOLEAN NOT NULL DEFAULT true,
    "env" TEXT NOT NULL DEFAULT 'prod',
    "last_seen" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "devices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organizations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "ward_email" TEXT NOT NULL,
    "ward_phone_number" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "wards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "phone_number" TEXT NOT NULL,
    "guardian_id" UUID,
    "organization_id" UUID,
    "ai_persona" TEXT DEFAULT '다미',
    "weekly_call_count" INTEGER NOT NULL DEFAULT 3,
    "call_duration_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "wards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_name" TEXT NOT NULL,
    "meta" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calls" (
    "call_id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "caller_user_id" UUID,
    "callee_user_id" UUID,
    "caller_identity" TEXT NOT NULL,
    "callee_identity" TEXT NOT NULL,
    "room_name" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ringing',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answered_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "calls_pkey" PRIMARY KEY ("call_id")
);

-- CreateTable
CREATE TABLE "room_members" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "room_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "room_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_id" UUID NOT NULL,
    "ward_id" UUID NOT NULL,
    "summary" TEXT,
    "mood" TEXT,
    "mood_score" DECIMAL(3,2),
    "tags" TEXT[],
    "health_keywords" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "health_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ward_id" UUID NOT NULL,
    "guardian_id" UUID NOT NULL,
    "alert_type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "health_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "call_reminder" BOOLEAN NOT NULL DEFAULT true,
    "call_complete" BOOLEAN NOT NULL DEFAULT true,
    "health_alert" BOOLEAN NOT NULL DEFAULT true,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notification_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardian_ward_registrations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "guardian_id" UUID NOT NULL,
    "ward_email" TEXT NOT NULL,
    "ward_phone_number" TEXT NOT NULL,
    "linked_ward_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "guardian_ward_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "call_schedules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ward_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "scheduled_time" TIME NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_called_at" TIMESTAMP(3),
    "reminder_sent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_schedules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "organization_wards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "organization_id" UUID NOT NULL,
    "uploaded_by_admin_id" UUID,
    "email" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "birth_date" DATE,
    "address" TEXT,
    "notes" TEXT,
    "is_registered" BOOLEAN NOT NULL DEFAULT false,
    "ward_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "organization_wards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ward_locations" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ward_id" UUID NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "accuracy" DECIMAL(6,2),
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ward_locations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ward_current_locations" (
    "ward_id" UUID NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "accuracy" DECIMAL(6,2),
    "status" TEXT NOT NULL DEFAULT 'normal',
    "last_updated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ward_current_locations_pkey" PRIMARY KEY ("ward_id")
);

-- CreateTable
CREATE TABLE "emergency_agencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "phone_number" TEXT NOT NULL,
    "latitude" DECIMAL(10,8) NOT NULL,
    "longitude" DECIMAL(11,8) NOT NULL,
    "address" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergencies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ward_id" UUID,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "latitude" DECIMAL(10,8),
    "longitude" DECIMAL(11,8),
    "message" TEXT,
    "guardian_notified" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMP(3),
    "resolved_by" UUID,
    "resolution_note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "emergency_id" UUID NOT NULL,
    "agency_id" UUID,
    "distance_km" DECIMAL(6,2),
    "contacted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response_status" TEXT NOT NULL DEFAULT 'pending',

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admins" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" TEXT NOT NULL,
    "name" TEXT,
    "provider" TEXT NOT NULL,
    "provider_id" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'viewer',
    "organization_id" UUID,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admins_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_permissions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "permission" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admin_refresh_tokens" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "admin_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "admin_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_identity_key" ON "users"("identity");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "users_kakao_id_key" ON "users"("kakao_id");

-- CreateIndex
CREATE INDEX "users_email_idx" ON "users"("email");

-- CreateIndex
CREATE INDEX "users_kakao_id_idx" ON "users"("kakao_id");

-- CreateIndex
CREATE INDEX "users_user_type_idx" ON "users"("user_type");

-- CreateIndex
CREATE UNIQUE INDEX "devices_apns_token_key" ON "devices"("apns_token");

-- CreateIndex
CREATE UNIQUE INDEX "devices_voip_token_key" ON "devices"("voip_token");

-- CreateIndex
CREATE INDEX "devices_user_id_idx" ON "devices"("user_id");

-- CreateIndex
CREATE INDEX "devices_env_idx" ON "devices"("env");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_user_id_key" ON "guardians"("user_id");

-- CreateIndex
CREATE INDEX "guardians_user_id_idx" ON "guardians"("user_id");

-- CreateIndex
CREATE INDEX "guardians_ward_email_idx" ON "guardians"("ward_email");

-- CreateIndex
CREATE UNIQUE INDEX "wards_user_id_key" ON "wards"("user_id");

-- CreateIndex
CREATE INDEX "wards_user_id_idx" ON "wards"("user_id");

-- CreateIndex
CREATE INDEX "wards_guardian_id_idx" ON "wards"("guardian_id");

-- CreateIndex
CREATE INDEX "wards_organization_id_idx" ON "wards"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_room_name_key" ON "rooms"("room_name");

-- CreateIndex
CREATE INDEX "calls_callee_identity_state_idx" ON "calls"("callee_identity", "state");

-- CreateIndex
CREATE INDEX "calls_room_name_idx" ON "calls"("room_name");

-- CreateIndex
CREATE INDEX "room_members_room_id_idx" ON "room_members"("room_id");

-- CreateIndex
CREATE UNIQUE INDEX "room_members_room_id_user_id_key" ON "room_members"("room_id", "user_id");

-- CreateIndex
CREATE INDEX "call_summaries_call_id_idx" ON "call_summaries"("call_id");

-- CreateIndex
CREATE INDEX "call_summaries_ward_id_idx" ON "call_summaries"("ward_id");

-- CreateIndex
CREATE INDEX "call_summaries_created_at_idx" ON "call_summaries"("created_at");

-- CreateIndex
CREATE INDEX "health_alerts_guardian_id_idx" ON "health_alerts"("guardian_id");

-- CreateIndex
CREATE INDEX "health_alerts_ward_id_idx" ON "health_alerts"("ward_id");

-- CreateIndex
CREATE INDEX "health_alerts_is_read_idx" ON "health_alerts"("is_read");

-- CreateIndex
CREATE UNIQUE INDEX "notification_settings_user_id_key" ON "notification_settings"("user_id");

-- CreateIndex
CREATE INDEX "notification_settings_user_id_idx" ON "notification_settings"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_idx" ON "refresh_tokens"("user_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_token_hash_idx" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "guardian_ward_registrations_guardian_id_idx" ON "guardian_ward_registrations"("guardian_id");

-- CreateIndex
CREATE INDEX "guardian_ward_registrations_ward_email_idx" ON "guardian_ward_registrations"("ward_email");

-- CreateIndex
CREATE INDEX "guardian_ward_registrations_linked_ward_id_idx" ON "guardian_ward_registrations"("linked_ward_id");

-- CreateIndex
CREATE INDEX "call_schedules_ward_id_idx" ON "call_schedules"("ward_id");

-- CreateIndex
CREATE INDEX "call_schedules_day_of_week_idx" ON "call_schedules"("day_of_week");

-- CreateIndex
CREATE INDEX "call_schedules_is_active_idx" ON "call_schedules"("is_active");

-- CreateIndex
CREATE INDEX "organization_wards_organization_id_idx" ON "organization_wards"("organization_id");

-- CreateIndex
CREATE INDEX "organization_wards_email_idx" ON "organization_wards"("email");

-- CreateIndex
CREATE INDEX "organization_wards_is_registered_idx" ON "organization_wards"("is_registered");

-- CreateIndex
CREATE INDEX "organization_wards_uploaded_by_admin_id_idx" ON "organization_wards"("uploaded_by_admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "organization_wards_organization_id_email_key" ON "organization_wards"("organization_id", "email");

-- CreateIndex
CREATE INDEX "ward_locations_ward_id_idx" ON "ward_locations"("ward_id");

-- CreateIndex
CREATE INDEX "ward_locations_recorded_at_idx" ON "ward_locations"("recorded_at");

-- CreateIndex
CREATE INDEX "ward_locations_ward_id_recorded_at_idx" ON "ward_locations"("ward_id", "recorded_at" DESC);

-- CreateIndex
CREATE INDEX "ward_current_locations_status_idx" ON "ward_current_locations"("status");

-- CreateIndex
CREATE INDEX "emergency_agencies_type_idx" ON "emergency_agencies"("type");

-- CreateIndex
CREATE INDEX "emergency_agencies_is_active_idx" ON "emergency_agencies"("is_active");

-- CreateIndex
CREATE INDEX "emergencies_ward_id_idx" ON "emergencies"("ward_id");

-- CreateIndex
CREATE INDEX "emergencies_status_idx" ON "emergencies"("status");

-- CreateIndex
CREATE INDEX "emergencies_created_at_idx" ON "emergencies"("created_at" DESC);

-- CreateIndex
CREATE INDEX "emergency_contacts_emergency_id_idx" ON "emergency_contacts"("emergency_id");

-- CreateIndex
CREATE INDEX "emergency_contacts_agency_id_idx" ON "emergency_contacts"("agency_id");

-- CreateIndex
CREATE UNIQUE INDEX "admins_email_key" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_email_idx" ON "admins"("email");

-- CreateIndex
CREATE INDEX "admins_provider_provider_id_idx" ON "admins"("provider", "provider_id");

-- CreateIndex
CREATE INDEX "admins_role_idx" ON "admins"("role");

-- CreateIndex
CREATE INDEX "admins_organization_id_idx" ON "admins"("organization_id");

-- CreateIndex
CREATE UNIQUE INDEX "admins_provider_provider_id_key" ON "admins"("provider", "provider_id");

-- CreateIndex
CREATE INDEX "admin_permissions_admin_id_idx" ON "admin_permissions"("admin_id");

-- CreateIndex
CREATE UNIQUE INDEX "admin_permissions_admin_id_permission_key" ON "admin_permissions"("admin_id", "permission");

-- CreateIndex
CREATE UNIQUE INDEX "admin_refresh_tokens_token_hash_key" ON "admin_refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "admin_refresh_tokens_admin_id_idx" ON "admin_refresh_tokens"("admin_id");

-- CreateIndex
CREATE INDEX "admin_refresh_tokens_token_hash_idx" ON "admin_refresh_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "devices" ADD CONSTRAINT "devices_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_caller_user_id_fkey" FOREIGN KEY ("caller_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calls" ADD CONSTRAINT "calls_callee_user_id_fkey" FOREIGN KEY ("callee_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_room_id_fkey" FOREIGN KEY ("room_id") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "room_members" ADD CONSTRAINT "room_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_summaries" ADD CONSTRAINT "call_summaries_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("call_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_summaries" ADD CONSTRAINT "call_summaries_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "health_alerts" ADD CONSTRAINT "health_alerts_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_ward_registrations" ADD CONSTRAINT "guardian_ward_registrations_guardian_id_fkey" FOREIGN KEY ("guardian_id") REFERENCES "guardians"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardian_ward_registrations" ADD CONSTRAINT "guardian_ward_registrations_linked_ward_id_fkey" FOREIGN KEY ("linked_ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "call_schedules" ADD CONSTRAINT "call_schedules_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_wards" ADD CONSTRAINT "organization_wards_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_wards" ADD CONSTRAINT "organization_wards_uploaded_by_admin_id_fkey" FOREIGN KEY ("uploaded_by_admin_id") REFERENCES "admins"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_wards" ADD CONSTRAINT "organization_wards_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ward_locations" ADD CONSTRAINT "ward_locations_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ward_current_locations" ADD CONSTRAINT "ward_current_locations_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergencies" ADD CONSTRAINT "emergencies_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_emergency_id_fkey" FOREIGN KEY ("emergency_id") REFERENCES "emergencies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "emergency_agencies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admins" ADD CONSTRAINT "admins_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_permissions" ADD CONSTRAINT "admin_permissions_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admin_refresh_tokens" ADD CONSTRAINT "admin_refresh_tokens_admin_id_fkey" FOREIGN KEY ("admin_id") REFERENCES "admins"("id") ON DELETE CASCADE ON UPDATE CASCADE;

