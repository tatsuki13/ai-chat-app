CREATE TABLE "web_rtc_signals" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "sender" TEXT NOT NULL,
    "recipient" TEXT NOT NULL,
    "message_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "web_rtc_signals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "web_rtc_signals_session_id_role_recipient_created_at_idx" ON "web_rtc_signals"("session_id", "role", "recipient", "created_at");
CREATE INDEX "web_rtc_signals_expires_at_idx" ON "web_rtc_signals"("expires_at");

ALTER TABLE "web_rtc_signals"
ADD CONSTRAINT "web_rtc_signals_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
