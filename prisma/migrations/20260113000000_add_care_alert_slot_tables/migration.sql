-- CreateTable: call_slot_configs (전역 슬롯 설정)
CREATE TABLE IF NOT EXISTS "call_slot_configs" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "slot_duration_minutes" INTEGER NOT NULL DEFAULT 10,
    "max_call_duration_minutes" INTEGER NOT NULL DEFAULT 8,
    "max_capacity_per_slot" INTEGER NOT NULL DEFAULT 40,
    "max_concurrent_calls" INTEGER NOT NULL DEFAULT 50,
    "valid_minutes" INTEGER[] NOT NULL DEFAULT ARRAY[0, 10, 20, 30, 40, 50],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "call_slot_configs_pkey" PRIMARY KEY ("id")
);

-- Insert default config
INSERT INTO "call_slot_configs" ("id") VALUES (1) ON CONFLICT ("id") DO NOTHING;

-- CreateTable: care_alert_events
CREATE TABLE IF NOT EXISTS "care_alert_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ward_id" UUID NOT NULL,
    "alert_type" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "raw_payload" JSONB NOT NULL,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledged_at" TIMESTAMP(3),
    "acknowledged_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "call_id" UUID,
    "room_name" TEXT,
    "agent_response" TEXT,
    "source" TEXT NOT NULL DEFAULT 'ios',

    CONSTRAINT "care_alert_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable: conversation_vectors (RAG)
CREATE TABLE IF NOT EXISTS "conversation_vectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ward_id" UUID NOT NULL,
    "call_id" UUID,
    "text" TEXT NOT NULL,
    "embedding" vector(1024),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_vectors_pkey" PRIMARY KEY ("id")
);

-- CreateTable: emotion_summaries
CREATE TABLE IF NOT EXISTS "emotion_summaries" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ward_id" UUID NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "positive_count" INTEGER NOT NULL DEFAULT 0,
    "neutral_count" INTEGER NOT NULL DEFAULT 0,
    "negative_count" INTEGER NOT NULL DEFAULT 0,
    "dominant_emotion" TEXT,
    "summary_text" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emotion_summaries_pkey" PRIMARY KEY ("id")
);

-- AlterTable: call_schedule_groups (time -> slot_start_hour, slot_start_minute)
-- First, add new columns if not exist
DO $$ 
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'call_schedule_groups' AND column_name = 'slot_start_hour') THEN
        ALTER TABLE "call_schedule_groups" ADD COLUMN "slot_start_hour" INTEGER;
        ALTER TABLE "call_schedule_groups" ADD COLUMN "slot_start_minute" INTEGER;
        
        -- Migrate existing data: time "HH:MM" -> slot_start_hour, slot_start_minute
        UPDATE "call_schedule_groups" 
        SET "slot_start_hour" = CAST(SPLIT_PART("time", ':', 1) AS INTEGER),
            "slot_start_minute" = CAST(SPLIT_PART("time", ':', 2) AS INTEGER)
        WHERE "time" IS NOT NULL;
        
        -- Set defaults for NULL values
        UPDATE "call_schedule_groups" SET "slot_start_hour" = 9 WHERE "slot_start_hour" IS NULL;
        UPDATE "call_schedule_groups" SET "slot_start_minute" = 0 WHERE "slot_start_minute" IS NULL;
        
        -- Make columns NOT NULL
        ALTER TABLE "call_schedule_groups" ALTER COLUMN "slot_start_hour" SET NOT NULL;
        ALTER TABLE "call_schedule_groups" ALTER COLUMN "slot_start_minute" SET NOT NULL;
        
        -- Drop old column
        ALTER TABLE "call_schedule_groups" DROP COLUMN IF EXISTS "time";
    END IF;
END $$;

-- CreateIndex for care_alert_events
CREATE INDEX IF NOT EXISTS "care_alert_events_ward_id_timestamp_idx" ON "care_alert_events"("ward_id", "timestamp" DESC);
CREATE INDEX IF NOT EXISTS "care_alert_events_alert_type_idx" ON "care_alert_events"("alert_type");
CREATE INDEX IF NOT EXISTS "care_alert_events_severity_idx" ON "care_alert_events"("severity");
CREATE INDEX IF NOT EXISTS "care_alert_events_acknowledged_idx" ON "care_alert_events"("acknowledged");
CREATE INDEX IF NOT EXISTS "care_alert_events_ward_id_alert_type_timestamp_idx" ON "care_alert_events"("ward_id", "alert_type", "timestamp");
CREATE INDEX IF NOT EXISTS "care_alert_events_call_id_idx" ON "care_alert_events"("call_id");

-- CreateIndex for conversation_vectors
CREATE INDEX IF NOT EXISTS "conversation_vectors_ward_id_idx" ON "conversation_vectors"("ward_id");
CREATE INDEX IF NOT EXISTS "conversation_vectors_call_id_idx" ON "conversation_vectors"("call_id");
CREATE INDEX IF NOT EXISTS "conversation_vectors_created_at_idx" ON "conversation_vectors"("created_at" DESC);

-- CreateIndex for emotion_summaries
CREATE INDEX IF NOT EXISTS "emotion_summaries_ward_id_period_start_idx" ON "emotion_summaries"("ward_id", "period_start" DESC);
CREATE UNIQUE INDEX IF NOT EXISTS "emotion_summaries_ward_id_period_start_period_end_key" ON "emotion_summaries"("ward_id", "period_start", "period_end");

-- CreateIndex for call_schedule_groups
CREATE INDEX IF NOT EXISTS "call_schedule_groups_slot_start_hour_slot_start_minute_idx" ON "call_schedule_groups"("slot_start_hour", "slot_start_minute");
CREATE UNIQUE INDEX IF NOT EXISTS "call_schedule_groups_ward_id_slot_start_hour_slot_start_minut_key" ON "call_schedule_groups"("ward_id", "slot_start_hour", "slot_start_minute");

-- AddForeignKey
ALTER TABLE "care_alert_events" DROP CONSTRAINT IF EXISTS "care_alert_events_ward_id_fkey";
ALTER TABLE "care_alert_events" ADD CONSTRAINT "care_alert_events_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "conversation_vectors" DROP CONSTRAINT IF EXISTS "conversation_vectors_ward_id_fkey";
ALTER TABLE "conversation_vectors" ADD CONSTRAINT "conversation_vectors_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "emotion_summaries" DROP CONSTRAINT IF EXISTS "emotion_summaries_ward_id_fkey";
ALTER TABLE "emotion_summaries" ADD CONSTRAINT "emotion_summaries_ward_id_fkey" FOREIGN KEY ("ward_id") REFERENCES "wards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
