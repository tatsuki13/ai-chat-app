ALTER TABLE "prepared_questions"
  ADD COLUMN "audio_status" TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN "audio_reference" TEXT,
  ADD COLUMN "audio_generated_at" TIMESTAMP(3),
  ADD COLUMN "audio_generation_ms" INTEGER,
  ADD COLUMN "audio_error" TEXT;

CREATE TABLE "tts_audio_caches" (
  "id" TEXT NOT NULL,
  "cache_key" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT,
  "content_type" TEXT NOT NULL,
  "topic_id" TEXT,
  "text" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "voice" TEXT NOT NULL,
  "instructions" TEXT NOT NULL,
  "format" TEXT NOT NULL,
  "audio" BYTEA NOT NULL,
  "byte_length" INTEGER NOT NULL,
  "duration_ms" INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_used_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "tts_audio_caches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_speech_states" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "playback_id" TEXT,
  "content_type" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "started_at" TIMESTAMP(3),
  "expected_end_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "release_after" TIMESTAMP(3),
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_speech_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tts_audio_caches_cache_key_key" ON "tts_audio_caches"("cache_key");
CREATE INDEX "tts_audio_caches_content_type_topic_id_idx" ON "tts_audio_caches"("content_type", "topic_id");
CREATE INDEX "tts_audio_caches_session_id_idx" ON "tts_audio_caches"("session_id");
CREATE INDEX "tts_audio_caches_participant_code_idx" ON "tts_audio_caches"("participant_code");
CREATE INDEX "tts_audio_caches_last_used_at_idx" ON "tts_audio_caches"("last_used_at");
CREATE UNIQUE INDEX "ai_speech_states_session_id_key" ON "ai_speech_states"("session_id");
CREATE INDEX "ai_speech_states_participant_code_idx" ON "ai_speech_states"("participant_code");
CREATE INDEX "ai_speech_states_active_idx" ON "ai_speech_states"("active");
CREATE INDEX "ai_speech_states_updated_at_idx" ON "ai_speech_states"("updated_at");

ALTER TABLE "tts_audio_caches"
  ADD CONSTRAINT "tts_audio_caches_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ai_speech_states"
  ADD CONSTRAINT "ai_speech_states_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
