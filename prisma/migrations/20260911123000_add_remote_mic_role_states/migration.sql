CREATE TABLE "remote_mic_role_states" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "connected_at" TIMESTAMP(3),
    "last_seen_at" TIMESTAMP(3),
    "realtime_connected" BOOLEAN NOT NULL DEFAULT false,
    "capture_state" TEXT NOT NULL DEFAULT 'idle',
    "muted" BOOLEAN NOT NULL DEFAULT true,
    "reconnect_attempt" INTEGER,
    "reconnect_reason" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "remote_mic_role_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "remote_mic_role_states_session_id_role_key" ON "remote_mic_role_states"("session_id", "role");
CREATE INDEX "remote_mic_role_states_session_id_idx" ON "remote_mic_role_states"("session_id");
CREATE INDEX "remote_mic_role_states_role_idx" ON "remote_mic_role_states"("role");
CREATE INDEX "remote_mic_role_states_last_seen_at_idx" ON "remote_mic_role_states"("last_seen_at");
CREATE INDEX "remote_mic_role_states_realtime_connected_idx" ON "remote_mic_role_states"("realtime_connected");
CREATE INDEX "remote_mic_role_states_capture_state_idx" ON "remote_mic_role_states"("capture_state");
CREATE INDEX "remote_mic_role_states_updated_at_idx" ON "remote_mic_role_states"("updated_at");

ALTER TABLE "remote_mic_role_states" ADD CONSTRAINT "remote_mic_role_states_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
