ALTER TABLE "utterances"
  ADD COLUMN IF NOT EXISTS "source_group_id" TEXT,
  ADD COLUMN IF NOT EXISTS "asr_provider" TEXT,
  ADD COLUMN IF NOT EXISTS "asr_model" TEXT,
  ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS "utterances_source_group_id_idx" ON "utterances"("source_group_id");
