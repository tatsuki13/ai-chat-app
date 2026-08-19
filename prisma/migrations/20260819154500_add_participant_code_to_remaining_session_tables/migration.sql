DO $$
BEGIN
  IF to_regclass('public.ai_action_events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'ai_action_events'
         AND column_name = 'participant_code'
     ) THEN
    ALTER TABLE "ai_action_events" ADD COLUMN "participant_code" TEXT;
  END IF;

  IF to_regclass('public.web_rtc_signals') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1
       FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'web_rtc_signals'
         AND column_name = 'participant_code'
     ) THEN
    ALTER TABLE "web_rtc_signals" ADD COLUMN "participant_code" TEXT;
  END IF;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.ai_action_events') IS NOT NULL THEN
    UPDATE "ai_action_events" target
    SET "participant_code" = source."participant_code"
    FROM "sessions" source
    WHERE source."id" = target."session_id"
      AND target."participant_code" IS DISTINCT FROM source."participant_code";

    CREATE INDEX IF NOT EXISTS "ai_action_events_participant_code_idx"
    ON "ai_action_events"("participant_code");
  END IF;

  IF to_regclass('public.web_rtc_signals') IS NOT NULL THEN
    UPDATE "web_rtc_signals" target
    SET "participant_code" = source."participant_code"
    FROM "sessions" source
    WHERE source."id" = target."session_id"
      AND target."participant_code" IS DISTINCT FROM source."participant_code";

    CREATE INDEX IF NOT EXISTS "web_rtc_signals_participant_code_idx"
    ON "web_rtc_signals"("participant_code");
  END IF;
END;
$$;

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

DO $$
BEGIN
  IF to_regclass('public.ai_action_events') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger WHERE tgname = 'ai_action_events_set_participant_code'
     ) THEN
    CREATE TRIGGER "ai_action_events_set_participant_code"
    BEFORE INSERT OR UPDATE OF "session_id" ON "ai_action_events"
    FOR EACH ROW
    EXECUTE FUNCTION "set_participant_code_from_session"();
  END IF;

  IF to_regclass('public.web_rtc_signals') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM pg_trigger WHERE tgname = 'web_rtc_signals_set_participant_code'
     ) THEN
    CREATE TRIGGER "web_rtc_signals_set_participant_code"
    BEFORE INSERT OR UPDATE OF "session_id" ON "web_rtc_signals"
    FOR EACH ROW
    EXECUTE FUNCTION "set_participant_code_from_session"();
  END IF;
END;
$$;

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

    IF to_regclass('public.ai_action_events') IS NOT NULL THEN
      UPDATE "ai_action_events" SET "participant_code" = NEW."participant_code" WHERE "session_id" = NEW."id";
    END IF;

    IF to_regclass('public.web_rtc_signals') IS NOT NULL THEN
      UPDATE "web_rtc_signals" SET "participant_code" = NEW."participant_code" WHERE "session_id" = NEW."id";
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
