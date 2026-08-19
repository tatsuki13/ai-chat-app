ALTER TABLE "utterances" ADD COLUMN "participant_code" TEXT;
ALTER TABLE "slot_states" ADD COLUMN "participant_code" TEXT;
ALTER TABLE "slot_sub_states" ADD COLUMN "participant_code" TEXT;
ALTER TABLE "final_minutes" ADD COLUMN "participant_code" TEXT;
ALTER TABLE "ai_intervention_logs" ADD COLUMN "participant_code" TEXT;
ALTER TABLE "remote_mic_join_tokens" ADD COLUMN "participant_code" TEXT;
ALTER TABLE "remote_mic_audio_chunks" ADD COLUMN "participant_code" TEXT;

UPDATE "utterances" target
SET "participant_code" = source."participant_code"
FROM "sessions" source
WHERE source."id" = target."session_id";

UPDATE "slot_states" target
SET "participant_code" = source."participant_code"
FROM "sessions" source
WHERE source."id" = target."session_id";

UPDATE "slot_sub_states" target
SET "participant_code" = source."participant_code"
FROM "sessions" source
WHERE source."id" = target."session_id";

UPDATE "final_minutes" target
SET "participant_code" = source."participant_code"
FROM "sessions" source
WHERE source."id" = target."session_id";

UPDATE "ai_intervention_logs" target
SET "participant_code" = source."participant_code"
FROM "sessions" source
WHERE source."id" = target."session_id";

UPDATE "remote_mic_join_tokens" target
SET "participant_code" = source."participant_code"
FROM "sessions" source
WHERE source."id" = target."session_id";

UPDATE "remote_mic_audio_chunks" target
SET "participant_code" = source."participant_code"
FROM "sessions" source
WHERE source."id" = target."session_id";

CREATE INDEX "utterances_participant_code_idx" ON "utterances"("participant_code");
CREATE INDEX "slot_states_participant_code_idx" ON "slot_states"("participant_code");
CREATE INDEX "slot_sub_states_participant_code_idx" ON "slot_sub_states"("participant_code");
CREATE INDEX "final_minutes_participant_code_idx" ON "final_minutes"("participant_code");
CREATE INDEX "ai_intervention_logs_participant_code_idx" ON "ai_intervention_logs"("participant_code");
CREATE INDEX "remote_mic_join_tokens_participant_code_idx" ON "remote_mic_join_tokens"("participant_code");
CREATE INDEX "remote_mic_audio_chunks_participant_code_idx" ON "remote_mic_audio_chunks"("participant_code");

CREATE OR REPLACE FUNCTION "set_participant_code_from_session"()
RETURNS TRIGGER AS $$
BEGIN
  SELECT "participant_code"
  INTO NEW."participant_code"
  FROM "sessions"
  WHERE "id" = NEW."session_id";

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

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

CREATE OR REPLACE FUNCTION "sync_session_participant_code_to_children"()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."participant_code" IS DISTINCT FROM OLD."participant_code" THEN
    UPDATE "utterances" SET "participant_code" = NEW."participant_code" WHERE "session_id" = NEW."id";
    UPDATE "slot_states" SET "participant_code" = NEW."participant_code" WHERE "session_id" = NEW."id";
    UPDATE "slot_sub_states" SET "participant_code" = NEW."participant_code" WHERE "session_id" = NEW."id";
    UPDATE "final_minutes" SET "participant_code" = NEW."participant_code" WHERE "session_id" = NEW."id";
    UPDATE "ai_intervention_logs" SET "participant_code" = NEW."participant_code" WHERE "session_id" = NEW."id";
    UPDATE "remote_mic_join_tokens" SET "participant_code" = NEW."participant_code" WHERE "session_id" = NEW."id";
    UPDATE "remote_mic_audio_chunks" SET "participant_code" = NEW."participant_code" WHERE "session_id" = NEW."id";
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "sessions_sync_participant_code_to_children"
AFTER UPDATE OF "participant_code" ON "sessions"
FOR EACH ROW
EXECUTE FUNCTION "sync_session_participant_code_to_children"();

CREATE OR REPLACE VIEW "research_utterances" AS
SELECT
  u."id" AS "utterance_id",
  u."session_id",
  u."participant_code",
  s."condition",
  u."speaker",
  u."text",
  u."created_at"
FROM "utterances" u
JOIN "sessions" s ON s."id" = u."session_id";

CREATE OR REPLACE VIEW "research_ai_intervention_logs" AS
SELECT
  l."id" AS "ai_intervention_log_id",
  l."session_id",
  l."participant_code",
  s."condition",
  l."type",
  l."content",
  l."topic_id",
  l."requested_at",
  l."generated_at",
  l."displayed_at",
  l."metadata",
  l."created_at"
FROM "ai_intervention_logs" l
JOIN "sessions" s ON s."id" = l."session_id";

CREATE OR REPLACE VIEW "research_final_minutes" AS
SELECT
  m."id" AS "final_minute_id",
  m."session_id",
  m."participant_code",
  s."condition",
  m."markdown",
  m."json",
  m."created_at"
FROM "final_minutes" m
JOIN "sessions" s ON s."id" = m."session_id";

CREATE OR REPLACE VIEW "research_slot_states" AS
SELECT
  st."id" AS "slot_state_id",
  st."session_id",
  st."participant_code",
  s."condition",
  st."slot_name",
  st."status",
  st."summary",
  st."evidence_utterance",
  st."updated_at"
FROM "slot_states" st
JOIN "sessions" s ON s."id" = st."session_id";

CREATE OR REPLACE VIEW "research_slot_sub_states" AS
SELECT
  ss."id" AS "slot_sub_state_id",
  ss."session_id",
  ss."participant_code",
  s."condition",
  ss."main_slot_id",
  ss."sub_slot_id",
  ss."completion",
  ss."response_state",
  ss."reason_code",
  ss."evidence_utterance_ids",
  ss."can_ask_again",
  ss."is_deferred",
  ss."last_updated_topic_id",
  ss."updated_at"
FROM "slot_sub_states" ss
JOIN "sessions" s ON s."id" = ss."session_id";

CREATE VIEW "research_remote_mic_join_tokens" AS
SELECT
  t."id" AS "remote_mic_join_token_id",
  t."session_id",
  t."participant_code",
  t."role",
  t."expires_at",
  t."used_at",
  t."revoked_at",
  t."last_heartbeat_at",
  t."disconnected_at",
  t."created_at"
FROM "remote_mic_join_tokens" t;

CREATE VIEW "research_remote_mic_audio_chunks" AS
SELECT
  c."id" AS "remote_mic_audio_chunk_id",
  c."session_id",
  c."participant_code",
  c."remote_mic_token_id",
  c."role",
  c."client_chunk_id",
  c."sequence",
  c."captured_at",
  c."duration_ms",
  c."average_level",
  c."peak_level",
  c."utterance_id",
  c."skipped",
  c."created_at"
FROM "remote_mic_audio_chunks" c;
