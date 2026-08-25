UPDATE "utterances" AS utterance
SET
  "start_ms" = CASE
    WHEN utterance."start_ms" IS NULL THEN GREATEST(
      0,
      ROUND(EXTRACT(EPOCH FROM (utterance."created_at" - session."started_at")) * 1000)::INTEGER
    )
    ELSE GREATEST(
      0,
      utterance."start_ms" + ROUND(
        EXTRACT(EPOCH FROM (COALESCE(session."dialogue_started_at", session."started_at") - session."started_at")) * 1000
      )::INTEGER
    )
  END,
  "end_ms" = CASE
    WHEN utterance."end_ms" IS NULL THEN GREATEST(
      0,
      ROUND(EXTRACT(EPOCH FROM (utterance."created_at" - session."started_at")) * 1000)::INTEGER
    )
    ELSE GREATEST(
      0,
      utterance."end_ms" + ROUND(
        EXTRACT(EPOCH FROM (COALESCE(session."dialogue_started_at", session."started_at") - session."started_at")) * 1000
      )::INTEGER
    )
  END
FROM "sessions" AS session
WHERE utterance."session_id" = session."id";

DROP VIEW IF EXISTS "session_utterances_with_participant";

CREATE VIEW "session_utterances_with_participant" AS
WITH ordered_utterances AS (
  SELECT
    session."participant_code",
    session."started_at" AS "session_started_at",
    session."dialogue_started_at",
    utterance."session_id",
    utterance."id" AS "utterance_id",
    utterance."speaker",
    utterance."text",
    utterance."start_ms",
    utterance."end_ms",
    LAG(utterance."end_ms") OVER (
      PARTITION BY utterance."session_id"
      ORDER BY utterance."start_ms", utterance."end_ms", utterance."created_at", utterance."id"
    ) AS "previous_end_ms",
    utterance."source",
    utterance."analysis_version",
    utterance."created_at"
  FROM "utterances" utterance
  JOIN "sessions" session ON session."id" = utterance."session_id"
)
SELECT
  "participant_code",
  "session_started_at",
  "dialogue_started_at",
  "session_id",
  "utterance_id",
  "speaker",
  "text",
  "start_ms",
  "end_ms",
  ROUND("start_ms" / 1000.0, 1) AS "start_sec",
  ROUND("end_ms" / 1000.0, 1) AS "end_sec",
  ROUND(("end_ms" - "start_ms") / 1000.0, 1) AS "duration_sec",
  CASE
    WHEN "previous_end_ms" IS NULL THEN NULL
    ELSE ROUND(("start_ms" - "previous_end_ms") / 1000.0, 1)
  END AS "gap_from_prev_sec",
  CONCAT(
    FLOOR("start_ms" / 60000.0)::INTEGER,
    ':',
    LPAD(FLOOR(MOD("start_ms", 60000) / 1000.0)::INTEGER::TEXT, 2, '0')
  ) AS "start_label",
  CONCAT(
    FLOOR("end_ms" / 60000.0)::INTEGER,
    ':',
    LPAD(FLOOR(MOD("end_ms", 60000) / 1000.0)::INTEGER::TEXT, 2, '0')
  ) AS "end_label",
  "source",
  "analysis_version",
  "created_at"
FROM ordered_utterances;
