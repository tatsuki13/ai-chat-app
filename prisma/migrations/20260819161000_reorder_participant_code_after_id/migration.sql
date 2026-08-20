BEGIN;

DROP VIEW IF EXISTS "session_utterances_with_participant";
DROP VIEW IF EXISTS "session_final_minutes_with_participant";

ALTER TABLE "remote_mic_audio_chunks" DROP CONSTRAINT IF EXISTS "remote_mic_audio_chunks_remote_mic_token_id_fkey";

ALTER TABLE "utterances" RENAME TO "__old_utterances";
ALTER TABLE "slot_states" RENAME TO "__old_slot_states";
ALTER TABLE "slot_sub_states" RENAME TO "__old_slot_sub_states";
ALTER TABLE "final_minutes" RENAME TO "__old_final_minutes";
ALTER TABLE "ai_intervention_logs" RENAME TO "__old_ai_intervention_logs";
ALTER TABLE "remote_mic_audio_chunks" RENAME TO "__old_remote_mic_audio_chunks";
ALTER TABLE "remote_mic_join_tokens" RENAME TO "__old_remote_mic_join_tokens";
ALTER TABLE "ai_action_events" RENAME TO "__old_ai_action_events";
ALTER TABLE "web_rtc_signals" RENAME TO "__old_web_rtc_signals";

CREATE TABLE "utterances" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "speaker" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "utterances" ("id", "participant_code", "session_id", "speaker", "text", "created_at")
SELECT "id", "participant_code", "session_id", "speaker", "text", "created_at"
FROM "__old_utterances";

CREATE TABLE "slot_states" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "slot_name" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence_utterance" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL
);

INSERT INTO "slot_states" ("id", "participant_code", "session_id", "slot_name", "status", "summary", "evidence_utterance", "updated_at")
SELECT "id", "participant_code", "session_id", "slot_name", "status", "summary", "evidence_utterance", "updated_at"
FROM "__old_slot_states";

CREATE TABLE "slot_sub_states" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "main_slot_id" TEXT NOT NULL,
  "sub_slot_id" TEXT NOT NULL,
  "completion" TEXT NOT NULL,
  "response_state" TEXT NOT NULL,
  "reason_code" TEXT,
  "evidence_utterance_ids" JSONB NOT NULL,
  "can_ask_again" BOOLEAN NOT NULL DEFAULT true,
  "is_deferred" BOOLEAN NOT NULL DEFAULT false,
  "last_updated_topic_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "depth" TEXT
);

INSERT INTO "slot_sub_states" ("id", "participant_code", "session_id", "main_slot_id", "sub_slot_id", "completion", "response_state", "reason_code", "evidence_utterance_ids", "can_ask_again", "is_deferred", "last_updated_topic_id", "updated_at", "depth")
SELECT "id", "participant_code", "session_id", "main_slot_id", "sub_slot_id", "completion", "response_state", "reason_code", "evidence_utterance_ids", "can_ask_again", "is_deferred", "last_updated_topic_id", "updated_at", "depth"
FROM "__old_slot_sub_states";

CREATE TABLE "final_minutes" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "markdown" TEXT NOT NULL,
  "json" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "final_minutes" ("id", "participant_code", "session_id", "markdown", "json", "created_at")
SELECT "id", "participant_code", "session_id", "markdown", "json", "created_at"
FROM "__old_final_minutes";

CREATE TABLE "ai_intervention_logs" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "topic_id" TEXT,
  "requested_at" TIMESTAMP(3),
  "generated_at" TIMESTAMP(3) NOT NULL,
  "displayed_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "ai_intervention_logs" ("id", "participant_code", "session_id", "type", "content", "topic_id", "requested_at", "generated_at", "displayed_at", "metadata", "created_at")
SELECT "id", "participant_code", "session_id", "type", "content", "topic_id", "requested_at", "generated_at", "displayed_at", "metadata", "created_at"
FROM "__old_ai_intervention_logs";

CREATE TABLE "remote_mic_join_tokens" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "token_hash" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "revoked_at" TIMESTAMP(3),
  "last_heartbeat_at" TIMESTAMP(3),
  "disconnected_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "remote_mic_join_tokens" ("id", "participant_code", "token_hash", "session_id", "role", "expires_at", "used_at", "revoked_at", "last_heartbeat_at", "disconnected_at", "created_at")
SELECT "id", "participant_code", "token_hash", "session_id", "role", "expires_at", "used_at", "revoked_at", "last_heartbeat_at", "disconnected_at", "created_at"
FROM "__old_remote_mic_join_tokens";

CREATE TABLE "remote_mic_audio_chunks" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
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
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "remote_mic_audio_chunks" ("id", "participant_code", "remote_mic_token_id", "session_id", "role", "client_chunk_id", "sequence", "captured_at", "duration_ms", "average_level", "peak_level", "utterance_id", "skipped", "created_at")
SELECT "id", "participant_code", "remote_mic_token_id", "session_id", "role", "client_chunk_id", "sequence", "captured_at", "duration_ms", "average_level", "peak_level", "utterance_id", "skipped", "created_at"
FROM "__old_remote_mic_audio_chunks";

CREATE TABLE "ai_action_events" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
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
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO "ai_action_events" ("id", "participant_code", "session_id", "action_type", "current_topic_id", "current_topic_title", "target_main_slot_id", "target_sub_slot_id", "generated_text", "reason", "result", "model", "policy_version", "metadata", "created_at")
SELECT "id", "participant_code", "session_id", "action_type", "current_topic_id", "current_topic_title", "target_main_slot_id", "target_sub_slot_id", "generated_text", "reason", "result", "model", "policy_version", "metadata", "created_at"
FROM "__old_ai_action_events";

CREATE TABLE "web_rtc_signals" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "sender" TEXT NOT NULL,
  "recipient" TEXT NOT NULL,
  "message_type" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL
);

INSERT INTO "web_rtc_signals" ("id", "participant_code", "session_id", "role", "sender", "recipient", "message_type", "payload", "created_at", "expires_at")
SELECT "id", "participant_code", "session_id", "role", "sender", "recipient", "message_type", "payload", "created_at", "expires_at"
FROM "__old_web_rtc_signals";

DROP TABLE "__old_remote_mic_audio_chunks";
DROP TABLE "__old_remote_mic_join_tokens";
DROP TABLE "__old_web_rtc_signals";
DROP TABLE "__old_ai_action_events";
DROP TABLE "__old_ai_intervention_logs";
DROP TABLE "__old_final_minutes";
DROP TABLE "__old_slot_sub_states";
DROP TABLE "__old_slot_states";
DROP TABLE "__old_utterances";

ALTER TABLE "utterances" ADD CONSTRAINT "utterances_pkey" PRIMARY KEY ("id");
ALTER TABLE "slot_states" ADD CONSTRAINT "slot_states_pkey" PRIMARY KEY ("id");
ALTER TABLE "slot_sub_states" ADD CONSTRAINT "slot_sub_states_pkey" PRIMARY KEY ("id");
ALTER TABLE "final_minutes" ADD CONSTRAINT "final_minutes_pkey" PRIMARY KEY ("id");
ALTER TABLE "ai_intervention_logs" ADD CONSTRAINT "ai_intervention_logs_pkey" PRIMARY KEY ("id");
ALTER TABLE "remote_mic_join_tokens" ADD CONSTRAINT "remote_mic_join_tokens_pkey" PRIMARY KEY ("id");
ALTER TABLE "remote_mic_audio_chunks" ADD CONSTRAINT "remote_mic_audio_chunks_pkey" PRIMARY KEY ("id");
ALTER TABLE "ai_action_events" ADD CONSTRAINT "ai_action_events_pkey" PRIMARY KEY ("id");
ALTER TABLE "web_rtc_signals" ADD CONSTRAINT "web_rtc_signals_pkey" PRIMARY KEY ("id");

CREATE INDEX "utterances_session_id_idx" ON "utterances"("session_id");
CREATE INDEX "utterances_participant_code_idx" ON "utterances"("participant_code");
CREATE INDEX "utterances_speaker_idx" ON "utterances"("speaker");
CREATE INDEX "utterances_created_at_idx" ON "utterances"("created_at");

CREATE UNIQUE INDEX "slot_states_session_id_slot_name_key" ON "slot_states"("session_id", "slot_name");
CREATE INDEX "slot_states_session_id_idx" ON "slot_states"("session_id");
CREATE INDEX "slot_states_participant_code_idx" ON "slot_states"("participant_code");
CREATE INDEX "slot_states_status_idx" ON "slot_states"("status");

CREATE UNIQUE INDEX "slot_sub_states_session_id_main_slot_id_sub_slot_id_key" ON "slot_sub_states"("session_id", "main_slot_id", "sub_slot_id");
CREATE INDEX "slot_sub_states_session_id_idx" ON "slot_sub_states"("session_id");
CREATE INDEX "slot_sub_states_participant_code_idx" ON "slot_sub_states"("participant_code");
CREATE INDEX "slot_sub_states_main_slot_id_idx" ON "slot_sub_states"("main_slot_id");
CREATE INDEX "slot_sub_states_sub_slot_id_idx" ON "slot_sub_states"("sub_slot_id");
CREATE INDEX "slot_sub_states_completion_idx" ON "slot_sub_states"("completion");
CREATE INDEX "slot_sub_states_response_state_idx" ON "slot_sub_states"("response_state");
CREATE INDEX "slot_sub_states_reason_code_idx" ON "slot_sub_states"("reason_code");

CREATE INDEX "final_minutes_session_id_idx" ON "final_minutes"("session_id");
CREATE INDEX "final_minutes_participant_code_idx" ON "final_minutes"("participant_code");
CREATE INDEX "final_minutes_created_at_idx" ON "final_minutes"("created_at");

CREATE INDEX "ai_intervention_logs_session_id_generated_at_idx" ON "ai_intervention_logs"("session_id", "generated_at");
CREATE INDEX "ai_intervention_logs_session_id_type_idx" ON "ai_intervention_logs"("session_id", "type");
CREATE INDEX "ai_intervention_logs_participant_code_idx" ON "ai_intervention_logs"("participant_code");
CREATE INDEX "ai_intervention_logs_topic_id_idx" ON "ai_intervention_logs"("topic_id");
CREATE INDEX "ai_intervention_logs_created_at_idx" ON "ai_intervention_logs"("created_at");

CREATE UNIQUE INDEX "remote_mic_join_tokens_token_hash_key" ON "remote_mic_join_tokens"("token_hash");
CREATE INDEX "remote_mic_join_tokens_session_id_role_revoked_at_expires_at_id" ON "remote_mic_join_tokens"("session_id", "role", "revoked_at", "expires_at");
CREATE INDEX "remote_mic_join_tokens_participant_code_idx" ON "remote_mic_join_tokens"("participant_code");
CREATE INDEX "remote_mic_join_tokens_expires_at_idx" ON "remote_mic_join_tokens"("expires_at");

CREATE UNIQUE INDEX "remote_mic_audio_chunks_remote_mic_token_id_client_chunk_id_key" ON "remote_mic_audio_chunks"("remote_mic_token_id", "client_chunk_id");
CREATE INDEX "remote_mic_audio_chunks_session_id_role_captured_at_idx" ON "remote_mic_audio_chunks"("session_id", "role", "captured_at");
CREATE INDEX "remote_mic_audio_chunks_participant_code_idx" ON "remote_mic_audio_chunks"("participant_code");
CREATE INDEX "remote_mic_audio_chunks_created_at_idx" ON "remote_mic_audio_chunks"("created_at");

CREATE INDEX "ai_action_events_session_id_idx" ON "ai_action_events"("session_id");
CREATE INDEX "ai_action_events_participant_code_idx" ON "ai_action_events"("participant_code");
CREATE INDEX "ai_action_events_action_type_idx" ON "ai_action_events"("action_type");
CREATE INDEX "ai_action_events_current_topic_id_idx" ON "ai_action_events"("current_topic_id");
CREATE INDEX "ai_action_events_created_at_idx" ON "ai_action_events"("created_at");

CREATE INDEX "web_rtc_signals_session_id_role_recipient_created_at_idx" ON "web_rtc_signals"("session_id", "role", "recipient", "created_at");
CREATE INDEX "web_rtc_signals_participant_code_idx" ON "web_rtc_signals"("participant_code");
CREATE INDEX "web_rtc_signals_expires_at_idx" ON "web_rtc_signals"("expires_at");

ALTER TABLE "utterances"
ADD CONSTRAINT "utterances_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "slot_states"
ADD CONSTRAINT "slot_states_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "slot_sub_states"
ADD CONSTRAINT "slot_sub_states_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "final_minutes"
ADD CONSTRAINT "final_minutes_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_intervention_logs"
ADD CONSTRAINT "ai_intervention_logs_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "remote_mic_join_tokens"
ADD CONSTRAINT "remote_mic_join_tokens_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "remote_mic_audio_chunks"
ADD CONSTRAINT "remote_mic_audio_chunks_remote_mic_token_id_fkey"
FOREIGN KEY ("remote_mic_token_id") REFERENCES "remote_mic_join_tokens"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ai_action_events"
ADD CONSTRAINT "ai_action_events_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "web_rtc_signals"
ADD CONSTRAINT "web_rtc_signals_session_id_fkey"
FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TRIGGER "utterances_set_participant_code"
BEFORE INSERT OR UPDATE OF "session_id" ON "utterances"
FOR EACH ROW
EXECUTE FUNCTION "set_participant_code_from_session"();

CREATE TRIGGER "slot_states_set_participant_code"
BEFORE INSERT OR UPDATE OF "session_id" ON "slot_states"
FOR EACH ROW
EXECUTE FUNCTION "set_participant_code_from_session"();

CREATE TRIGGER "slot_sub_states_set_participant_code"
BEFORE INSERT OR UPDATE OF "session_id" ON "slot_sub_states"
FOR EACH ROW
EXECUTE FUNCTION "set_participant_code_from_session"();

CREATE TRIGGER "final_minutes_set_participant_code"
BEFORE INSERT OR UPDATE OF "session_id" ON "final_minutes"
FOR EACH ROW
EXECUTE FUNCTION "set_participant_code_from_session"();

CREATE TRIGGER "ai_intervention_logs_set_participant_code"
BEFORE INSERT OR UPDATE OF "session_id" ON "ai_intervention_logs"
FOR EACH ROW
EXECUTE FUNCTION "set_participant_code_from_session"();

CREATE TRIGGER "remote_mic_join_tokens_set_participant_code"
BEFORE INSERT OR UPDATE OF "session_id" ON "remote_mic_join_tokens"
FOR EACH ROW
EXECUTE FUNCTION "set_participant_code_from_session"();

CREATE TRIGGER "remote_mic_audio_chunks_set_participant_code"
BEFORE INSERT OR UPDATE OF "session_id" ON "remote_mic_audio_chunks"
FOR EACH ROW
EXECUTE FUNCTION "set_participant_code_from_session"();

CREATE TRIGGER "ai_action_events_set_participant_code"
BEFORE INSERT OR UPDATE OF "session_id" ON "ai_action_events"
FOR EACH ROW
EXECUTE FUNCTION "set_participant_code_from_session"();

CREATE TRIGGER "web_rtc_signals_set_participant_code"
BEFORE INSERT OR UPDATE OF "session_id" ON "web_rtc_signals"
FOR EACH ROW
EXECUTE FUNCTION "set_participant_code_from_session"();

CREATE VIEW "session_utterances_with_participant" AS
SELECT
  session."participant_code",
  utterance."session_id",
  utterance."id" AS "utterance_id",
  utterance."speaker",
  utterance."text",
  utterance."created_at"
FROM "utterances" utterance
JOIN "sessions" session ON session."id" = utterance."session_id";

CREATE VIEW "session_final_minutes_with_participant" AS
SELECT
  session."participant_code",
  minute."session_id",
  minute."id" AS "final_minute_id",
  minute."markdown",
  minute."json",
  minute."created_at"
FROM "final_minutes" minute
JOIN "sessions" session ON session."id" = minute."session_id";

COMMIT;
