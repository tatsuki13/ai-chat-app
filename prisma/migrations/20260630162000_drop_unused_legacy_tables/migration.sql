-- Drop research mirror tables, legacy experiment-log tables, and the default
-- Neon sample table.
-- Current ACP session data is stored in sessions, utterances, button_events,
-- ai_suggestions, slot_states, and final_minutes.
DROP TABLE IF EXISTS "study_slot_evidence";
DROP TABLE IF EXISTS "study_slot_states";
DROP TABLE IF EXISTS "acp_slot_definitions";
DROP TABLE IF EXISTS "intervention_effects";
DROP TABLE IF EXISTS "study_interventions";
DROP TABLE IF EXISTS "topic_metrics";
DROP TABLE IF EXISTS "study_topic_trials";
DROP TABLE IF EXISTS "study_utterances";
DROP TABLE IF EXISTS "session_metrics";
DROP TABLE IF EXISTS "nasa_tlx_responses";
DROP TABLE IF EXISTS "dialogue_evaluation_responses";
DROP TABLE IF EXISTS "minutes_evaluations";
DROP TABLE IF EXISTS "session_auxiliary_items";
DROP TABLE IF EXISTS "study_sessions";
DROP TABLE IF EXISTS "Intervention";
DROP TABLE IF EXISTS "Utterance";
DROP TABLE IF EXISTS "TopicLog";
DROP TABLE IF EXISTS "ExperimentSession";
DROP TABLE IF EXISTS "playing_with_neon";
