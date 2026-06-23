UPDATE "sessions"
SET "participant_code" = NULL
WHERE "participant_code" IS NOT NULL
  AND btrim("participant_code") = '';

WITH ranked AS (
  SELECT
    "id",
    "participant_code",
    row_number() OVER (
      PARTITION BY "participant_code"
      ORDER BY "started_at", "id"
    ) AS duplicate_index
  FROM "sessions"
  WHERE "participant_code" IS NOT NULL
)
UPDATE "sessions" AS session
SET "participant_code" = ranked."participant_code" || '-' || substr(md5(ranked."id"), 1, 6)
FROM ranked
WHERE session."id" = ranked."id"
  AND ranked.duplicate_index > 1;

DROP INDEX IF EXISTS "sessions_participant_code_idx";

CREATE UNIQUE INDEX "sessions_participant_code_key"
ON "sessions"("participant_code");

CREATE OR REPLACE VIEW "session_utterances_with_participant" AS
SELECT
  session."participant_code",
  utterance."session_id",
  utterance."id" AS "utterance_id",
  utterance."speaker",
  utterance."text",
  utterance."created_at"
FROM "utterances" AS utterance
JOIN "sessions" AS session
  ON session."id" = utterance."session_id";

CREATE OR REPLACE VIEW "session_ai_suggestions_with_participant" AS
SELECT
  session."participant_code",
  suggestion."session_id",
  suggestion."id" AS "suggestion_id",
  suggestion."suggestion_type",
  suggestion."target_slot",
  suggestion."content",
  suggestion."reasoning",
  suggestion."adopted",
  suggestion."created_at"
FROM "ai_suggestions" AS suggestion
JOIN "sessions" AS session
  ON session."id" = suggestion."session_id";

CREATE OR REPLACE VIEW "session_final_minutes_with_participant" AS
SELECT
  session."participant_code",
  minute."session_id",
  minute."id" AS "final_minute_id",
  minute."markdown",
  minute."json",
  minute."created_at"
FROM "final_minutes" AS minute
JOIN "sessions" AS session
  ON session."id" = minute."session_id";
