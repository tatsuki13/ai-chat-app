CREATE TABLE IF NOT EXISTS "remote_mic_active_sessions" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "activated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "remote_mic_active_sessions_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "remote_mic_active_sessions_session_id_fkey"
    FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "remote_mic_active_sessions_channel_key"
  ON "remote_mic_active_sessions"("channel");

CREATE INDEX IF NOT EXISTS "remote_mic_active_sessions_session_id_idx"
  ON "remote_mic_active_sessions"("session_id");

CREATE INDEX IF NOT EXISTS "remote_mic_active_sessions_updated_at_idx"
  ON "remote_mic_active_sessions"("updated_at");
