ALTER TABLE "utterances"
  ADD COLUMN IF NOT EXISTS "remote_stream_id" TEXT,
  ADD COLUMN IF NOT EXISTS "remote_transcript_id" TEXT,
  ADD COLUMN IF NOT EXISTS "capture_epoch" INTEGER,
  ADD COLUMN IF NOT EXISTS "captured_during_ai_speech" BOOLEAN,
  ADD COLUMN IF NOT EXISTS "ai_playback_id_at_capture" TEXT,
  ADD COLUMN IF NOT EXISTS "first_partial_at" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "finalized_at" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "utterances_remote_transcript_id_idx"
  ON "utterances"("remote_transcript_id");

CREATE INDEX IF NOT EXISTS "utterances_remote_stream_id_idx"
  ON "utterances"("remote_stream_id");

CREATE UNIQUE INDEX IF NOT EXISTS "utterances_session_id_speaker_remote_stream_id_remote_transcript_id_key"
  ON "utterances"("session_id", "speaker", "remote_stream_id", "remote_transcript_id");
