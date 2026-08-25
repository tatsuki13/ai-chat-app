UPDATE "utterances" AS utterance
SET
  "start_ms" = GREATEST(
    0,
    ROUND(
      EXTRACT(
        EPOCH FROM (
          utterance."created_at" - COALESCE(session."dialogue_started_at", session."started_at")
        )
      ) * 1000
    )::INTEGER
  ),
  "end_ms" = GREATEST(
    0,
    ROUND(
      EXTRACT(
        EPOCH FROM (
          utterance."created_at" - COALESCE(session."dialogue_started_at", session."started_at")
        )
      ) * 1000
    )::INTEGER
  )
FROM "sessions" AS session
WHERE utterance."session_id" = session."id"
  AND (utterance."start_ms" IS NULL OR utterance."end_ms" IS NULL);

DROP VIEW IF EXISTS "session_utterances_with_participant";

CREATE VIEW "session_utterances_with_participant" AS
SELECT
  session."participant_code",
  utterance."session_id",
  utterance."id" AS "utterance_id",
  utterance."speaker",
  utterance."text",
  utterance."start_ms",
  utterance."end_ms",
  utterance."source",
  utterance."analysis_version",
  utterance."created_at"
FROM "utterances" utterance
JOIN "sessions" session ON session."id" = utterance."session_id";
