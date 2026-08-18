ALTER TABLE "sessions"
  ADD COLUMN "session_access_token_hash" TEXT,
  ADD COLUMN "current_topic_id" TEXT,
  ADD COLUMN "current_topic_index" INTEGER,
  ADD COLUMN "topic_started_at" TIMESTAMP(3),
  ADD COLUMN "conversation_phase" TEXT,
  ADD COLUMN "topic_paused_ms" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "protocol_version" TEXT,
  ADD COLUMN "app_version" TEXT,
  ADD COLUMN "ai_policy_version" TEXT;

CREATE UNIQUE INDEX "sessions_session_access_token_hash_key"
  ON "sessions"("session_access_token_hash");

CREATE INDEX "sessions_current_topic_id_idx"
  ON "sessions"("current_topic_id");

ALTER TABLE "slot_sub_states"
  ADD COLUMN "depth" TEXT;

UPDATE "slot_sub_states"
SET "depth" = CASE
  WHEN "response_state" = 'no_response' THEN 'none'
  WHEN "completion" IN ('complete', 'partial') THEN 'minimal'
  ELSE 'none'
END
WHERE "depth" IS NULL;

CREATE TABLE "ai_action_events" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "action_type" TEXT NOT NULL,
  "current_topic_id" TEXT,
  "current_topic_title" TEXT,
  "target_main_slot_id" TEXT,
  "target_sub_slot_id" TEXT,
  "generated_text" TEXT,
  "reason" TEXT,
  "result" TEXT,
  "model" TEXT,
  "policy_version" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_action_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_action_events_session_id_created_at_idx"
  ON "ai_action_events"("session_id", "created_at");

CREATE INDEX "ai_action_events_action_type_idx"
  ON "ai_action_events"("action_type");

CREATE INDEX "ai_action_events_current_topic_id_idx"
  ON "ai_action_events"("current_topic_id");

ALTER TABLE "ai_action_events"
  ADD CONSTRAINT "ai_action_events_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
