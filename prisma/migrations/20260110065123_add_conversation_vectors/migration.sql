-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateTable
CREATE TABLE "conversation_vectors" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "ward_id" UUID NOT NULL,
    "call_id" UUID NOT NULL,
    "chunk_text" TEXT NOT NULL,
    "embedding" vector(1024),
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_vectors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "conversation_vectors_ward_id_idx" ON "conversation_vectors"("ward_id");

-- CreateIndex
CREATE INDEX "conversation_vectors_call_id_idx" ON "conversation_vectors"("call_id");

-- CreateIndex
CREATE INDEX "conversation_vectors_created_at_idx" ON "conversation_vectors"("created_at");

-- CreateIndex (HNSW index for fast vector similarity search)
-- Parameters: m=16 (connections per layer), ef_construction=64 (search quality during build)
CREATE INDEX "conversation_vectors_embedding_idx" ON "conversation_vectors"
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

-- Composite index for ward + time-based queries
CREATE INDEX "conversation_vectors_ward_id_created_at_idx" ON "conversation_vectors"("ward_id", "created_at" DESC);
