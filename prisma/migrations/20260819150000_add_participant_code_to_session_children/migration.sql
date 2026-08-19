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
