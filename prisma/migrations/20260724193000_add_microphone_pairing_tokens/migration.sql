CREATE TABLE "microphone_pairing_tokens" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "microphone_pairing_tokens_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "microphone_pairing_tokens_session_id_role_key" ON "microphone_pairing_tokens"("session_id", "role");
CREATE INDEX "microphone_pairing_tokens_token_hash_idx" ON "microphone_pairing_tokens"("token_hash");
CREATE INDEX "microphone_pairing_tokens_expires_at_idx" ON "microphone_pairing_tokens"("expires_at");

ALTER TABLE "microphone_pairing_tokens"
ADD CONSTRAINT "microphone_pairing_tokens_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
