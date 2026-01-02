-- CreateTable
CREATE TABLE "transcripts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "call_id" UUID NOT NULL,
    "room_name" TEXT NOT NULL,
    "speaker_id" TEXT NOT NULL,
    "speaker_type" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "audio_features" JSONB,

    CONSTRAINT "transcripts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "transcripts_call_id_idx" ON "transcripts"("call_id");

-- CreateIndex
CREATE INDEX "transcripts_room_name_idx" ON "transcripts"("room_name");

-- CreateIndex
CREATE INDEX "transcripts_timestamp_idx" ON "transcripts"("timestamp");

-- AddForeignKey
ALTER TABLE "transcripts" ADD CONSTRAINT "transcripts_call_id_fkey" FOREIGN KEY ("call_id") REFERENCES "calls"("call_id") ON DELETE CASCADE ON UPDATE CASCADE;
