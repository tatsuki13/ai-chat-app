CREATE TABLE "remote_mic_join_tokens" (
    "id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "last_heartbeat_at" TIMESTAMP(3),
    "disconnected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remote_mic_join_tokens_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "remote_mic_audio_chunks" (
    "id" TEXT NOT NULL,
    "remote_mic_token_id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "client_chunk_id" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "captured_at" TIMESTAMP(3) NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "average_level" DOUBLE PRECISION,
    "peak_level" DOUBLE PRECISION,
    "utterance_id" TEXT,
    "skipped" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "remote_mic_audio_chunks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "remote_mic_join_tokens_token_hash_key" ON "remote_mic_join_tokens"("token_hash");
CREATE INDEX "remote_mic_join_tokens_session_id_role_revoked_at_expires_at_idx" ON "remote_mic_join_tokens"("session_id", "role", "revoked_at", "expires_at");
CREATE INDEX "remote_mic_join_tokens_expires_at_idx" ON "remote_mic_join_tokens"("expires_at");
CREATE UNIQUE INDEX "remote_mic_audio_chunks_remote_mic_token_id_client_chunk_id_key" ON "remote_mic_audio_chunks"("remote_mic_token_id", "client_chunk_id");
CREATE INDEX "remote_mic_audio_chunks_session_id_role_captured_at_idx" ON "remote_mic_audio_chunks"("session_id", "role", "captured_at");
CREATE INDEX "remote_mic_audio_chunks_created_at_idx" ON "remote_mic_audio_chunks"("created_at");

ALTER TABLE "remote_mic_join_tokens" ADD CONSTRAINT "remote_mic_join_tokens_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "remote_mic_audio_chunks" ADD CONSTRAINT "remote_mic_audio_chunks_remote_mic_token_id_fkey" FOREIGN KEY ("remote_mic_token_id") REFERENCES "remote_mic_join_tokens"("id") ON DELETE CASCADE ON UPDATE CASCADE;
