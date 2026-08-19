CREATE VIEW "research_sessions" AS
SELECT
  "id" AS "session_id",
  "participant_code",
  "condition",
  "started_at",
  "dialogue_started_at",
  "ended_at"
FROM "sessions";

CREATE VIEW "research_utterances" AS
SELECT
  u."id" AS "utterance_id",
  u."session_id",
  s."participant_code",
  s."condition",
  u."speaker",
  u."text",
  u."created_at"
FROM "utterances" u
JOIN "sessions" s ON s."id" = u."session_id";

CREATE VIEW "research_ai_intervention_logs" AS
SELECT
  l."id" AS "ai_intervention_log_id",
  l."session_id",
  s."participant_code",
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

CREATE VIEW "research_final_minutes" AS
SELECT
  m."id" AS "final_minute_id",
  m."session_id",
  s."participant_code",
  s."condition",
  m."markdown",
  m."json",
  m."created_at"
FROM "final_minutes" m
JOIN "sessions" s ON s."id" = m."session_id";

CREATE VIEW "research_slot_states" AS
SELECT
  st."id" AS "slot_state_id",
  st."session_id",
  s."participant_code",
  s."condition",
  st."slot_name",
  st."status",
  st."summary",
  st."evidence_utterance",
  st."updated_at"
FROM "slot_states" st
JOIN "sessions" s ON s."id" = st."session_id";

CREATE VIEW "research_slot_sub_states" AS
SELECT
  ss."id" AS "slot_sub_state_id",
  ss."session_id",
  s."participant_code",
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
