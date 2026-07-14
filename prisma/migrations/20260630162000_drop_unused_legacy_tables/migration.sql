-- Drop research mirror tables, legacy experiment-log tables, and the default
-- Neon sample table.
-- Current ACP session data is stored in sessions, utterances, button_events,
-- ai_suggestions, slot_states, and final_minutes.
DROP TABLE IF EXISTS "study_slot_evidence" CASCADE;
DROP TABLE IF EXISTS "study_slot_states" CASCADE;
DROP TABLE IF EXISTS "acp_slot_definitions" CASCADE;
DROP TABLE IF EXISTS "intervention_effects" CASCADE;
DROP TABLE IF EXISTS "study_interventions" CASCADE;
DROP TABLE IF EXISTS "topic_metrics" CASCADE;
DROP TABLE IF EXISTS "study_topic_trials" CASCADE;
DROP TABLE IF EXISTS "study_utterances" CASCADE;
DROP TABLE IF EXISTS "session_metrics" CASCADE;
DROP TABLE IF EXISTS "nasa_tlx_responses" CASCADE;
DROP TABLE IF EXISTS "dialogue_evaluation_responses" CASCADE;
DROP TABLE IF EXISTS "minutes_evaluations" CASCADE;
DROP TABLE IF EXISTS "session_auxiliary_items" CASCADE;
DROP TABLE IF EXISTS "study_sessions" CASCADE;
DROP TABLE IF EXISTS "Intervention" CASCADE;
DROP TABLE IF EXISTS "Utterance" CASCADE;
DROP TABLE IF EXISTS "TopicLog" CASCADE;
DROP TABLE IF EXISTS "ExperimentSession" CASCADE;
DROP TABLE IF EXISTS "playing_with_neon" CASCADE;
