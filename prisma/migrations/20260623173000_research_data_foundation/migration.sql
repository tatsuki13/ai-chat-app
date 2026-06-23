-- Research data foundation for ACP / AI-intervention analysis.
-- Existing app tables are preserved; these tables add an analysis layer.

CREATE TABLE "study_sessions" (
  "id" TEXT NOT NULL,
  "app_session_id" TEXT,
  "experiment_session_id" TEXT,
  "participant_code" TEXT,
  "condition" TEXT,
  "source" TEXT NOT NULL DEFAULT 'session_app',
  "protocol_version" TEXT,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "raw_log" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_sessions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_topic_trials" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "legacy_topic_log_id" TEXT,
  "topic_id" TEXT NOT NULL,
  "topic_index" INTEGER NOT NULL,
  "title" TEXT,
  "prompted_slot_id" TEXT,
  "question" TEXT,
  "presented_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "ended_at" TIMESTAMP(3),
  "first_utterance_at" TIMESTAMP(3),
  "latency_to_first_utterance_ms" INTEGER,
  "end_reason" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_topic_trials_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_utterances" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "topic_trial_id" TEXT,
  "app_utterance_id" TEXT,
  "legacy_utterance_id" TEXT,
  "speaker" TEXT NOT NULL,
  "text" TEXT NOT NULL,
  "event_type" TEXT,
  "timestamp" TIMESTAMP(3) NOT NULL,
  "char_count" INTEGER NOT NULL DEFAULT 0,
  "word_count" INTEGER,
  "self_disclosure_cue" BOOLEAN NOT NULL DEFAULT false,
  "raw_entry" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_utterances_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_interventions" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "topic_trial_id" TEXT,
  "app_suggestion_id" TEXT,
  "button_event_id" TEXT,
  "legacy_intervention_id" TEXT,
  "intervention_type" TEXT NOT NULL,
  "reason" TEXT,
  "intervention_number" INTEGER,
  "prompted_slot_id" TEXT,
  "ai_text" TEXT NOT NULL,
  "ai_reasoning" TEXT,
  "source" TEXT NOT NULL DEFAULT 'conversation_ai',
  "adopted" BOOLEAN,
  "silence_duration_ms" INTEGER,
  "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "raw_entry" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_interventions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "acp_slot_definitions" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "category" TEXT,
  "priority" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "acp_slot_definitions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_slot_states" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "slot_id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "source_type" TEXT NOT NULL DEFAULT 'unknown',
  "confidence" DOUBLE PRECISION,
  "evidence_utterance" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_slot_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "study_slot_evidence" (
  "id" TEXT NOT NULL,
  "slot_state_id" TEXT NOT NULL,
  "utterance_id" TEXT,
  "evidence_type" TEXT NOT NULL,
  "note" TEXT,
  "source_text" TEXT,
  "confidence" DOUBLE PRECISION,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "study_slot_evidence_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session_metrics" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "total_turns" INTEGER NOT NULL DEFAULT 0,
  "total_words" INTEGER NOT NULL DEFAULT 0,
  "total_characters" INTEGER NOT NULL DEFAULT 0,
  "total_duration_sec" INTEGER,
  "topic_count" INTEGER NOT NULL DEFAULT 0,
  "intervention_count" INTEGER NOT NULL DEFAULT 0,
  "silence_intervention_count" INTEGER NOT NULL DEFAULT 0,
  "filled_slot_count" INTEGER NOT NULL DEFAULT 0,
  "slot_completion_rate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "self_disclosure_score" DOUBLE PRECISION,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "method_version" TEXT,
  CONSTRAINT "session_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "topic_metrics" (
  "id" TEXT NOT NULL,
  "topic_trial_id" TEXT NOT NULL,
  "topic_duration_sec" INTEGER,
  "user_turn_count" INTEGER NOT NULL DEFAULT 0,
  "user_word_count" INTEGER NOT NULL DEFAULT 0,
  "caregiver_turn_count" INTEGER NOT NULL DEFAULT 0,
  "caregiver_word_count" INTEGER NOT NULL DEFAULT 0,
  "intervention_count" INTEGER NOT NULL DEFAULT 0,
  "silence_count" INTEGER NOT NULL DEFAULT 0,
  "total_silence_ms" INTEGER NOT NULL DEFAULT 0,
  "max_silence_ms" INTEGER NOT NULL DEFAULT 0,
  "avg_silence_ms" DOUBLE PRECISION,
  "new_slots_filled" INTEGER NOT NULL DEFAULT 0,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "topic_metrics_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "intervention_effects" (
  "id" TEXT NOT NULL,
  "intervention_id" TEXT NOT NULL,
  "words_before" INTEGER NOT NULL DEFAULT 0,
  "words_after" INTEGER NOT NULL DEFAULT 0,
  "turns_before" INTEGER NOT NULL DEFAULT 0,
  "turns_after" INTEGER NOT NULL DEFAULT 0,
  "slot_filled_after" BOOLEAN NOT NULL DEFAULT false,
  "silence_before" INTEGER,
  "silence_after" INTEGER,
  "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "intervention_effects_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "nasa_tlx_responses" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "mental_demand" INTEGER NOT NULL,
  "physical_demand" INTEGER NOT NULL,
  "temporal_demand" INTEGER NOT NULL,
  "performance" INTEGER NOT NULL,
  "effort" INTEGER NOT NULL,
  "frustration" INTEGER NOT NULL,
  "overall_score" DOUBLE PRECISION NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "external_response_id" TEXT,
  "raw_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "nasa_tlx_responses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "dialogue_evaluation_responses" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "easy_to_talk" INTEGER NOT NULL,
  "thoughts_organized" INTEGER NOT NULL,
  "values_shared" INTEGER NOT NULL,
  "thought_about_acp" INTEGER NOT NULL,
  "satisfied" INTEGER NOT NULL,
  "trusted_ai" INTEGER,
  "want_use_again" INTEGER,
  "ai_intervention_natural" INTEGER,
  "source" TEXT NOT NULL DEFAULT 'manual',
  "external_response_id" TEXT,
  "raw_payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "dialogue_evaluation_responses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "minutes_evaluations" (
  "id" TEXT NOT NULL,
  "final_minute_id" TEXT,
  "study_session_id" TEXT NOT NULL,
  "completeness_score" DOUBLE PRECISION,
  "evidence_score" DOUBLE PRECISION,
  "hallucination_risk" DOUBLE PRECISION,
  "evaluator" TEXT,
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "minutes_evaluations_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "session_auxiliary_items" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "item_name" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "evidence_utterance" TEXT,
  "source" TEXT NOT NULL DEFAULT 'minutes_generation',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "session_auxiliary_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "study_sessions_app_session_id_key" ON "study_sessions"("app_session_id");
CREATE UNIQUE INDEX "study_sessions_experiment_session_id_key" ON "study_sessions"("experiment_session_id");
CREATE INDEX "study_sessions_condition_idx" ON "study_sessions"("condition");
CREATE INDEX "study_sessions_participant_code_idx" ON "study_sessions"("participant_code");
CREATE INDEX "study_sessions_started_at_idx" ON "study_sessions"("started_at");

CREATE UNIQUE INDEX "study_topic_trials_session_id_topic_index_key" ON "study_topic_trials"("session_id", "topic_index");
CREATE UNIQUE INDEX "study_topic_trials_legacy_topic_log_id_key" ON "study_topic_trials"("legacy_topic_log_id");
CREATE INDEX "study_topic_trials_session_id_idx" ON "study_topic_trials"("session_id");
CREATE INDEX "study_topic_trials_topic_id_idx" ON "study_topic_trials"("topic_id");
CREATE INDEX "study_topic_trials_prompted_slot_id_idx" ON "study_topic_trials"("prompted_slot_id");

CREATE UNIQUE INDEX "study_utterances_app_utterance_id_key" ON "study_utterances"("app_utterance_id");
CREATE UNIQUE INDEX "study_utterances_legacy_utterance_id_key" ON "study_utterances"("legacy_utterance_id");
CREATE INDEX "study_utterances_session_id_idx" ON "study_utterances"("session_id");
CREATE INDEX "study_utterances_topic_trial_id_idx" ON "study_utterances"("topic_trial_id");
CREATE INDEX "study_utterances_speaker_idx" ON "study_utterances"("speaker");
CREATE INDEX "study_utterances_timestamp_idx" ON "study_utterances"("timestamp");

CREATE UNIQUE INDEX "study_interventions_app_suggestion_id_key" ON "study_interventions"("app_suggestion_id");
CREATE UNIQUE INDEX "study_interventions_legacy_intervention_id_key" ON "study_interventions"("legacy_intervention_id");
CREATE INDEX "study_interventions_session_id_idx" ON "study_interventions"("session_id");
CREATE INDEX "study_interventions_topic_trial_id_idx" ON "study_interventions"("topic_trial_id");
CREATE INDEX "study_interventions_intervention_type_idx" ON "study_interventions"("intervention_type");
CREATE INDEX "study_interventions_prompted_slot_id_idx" ON "study_interventions"("prompted_slot_id");
CREATE INDEX "study_interventions_timestamp_idx" ON "study_interventions"("timestamp");

CREATE INDEX "acp_slot_definitions_active_idx" ON "acp_slot_definitions"("active");
CREATE INDEX "acp_slot_definitions_priority_idx" ON "acp_slot_definitions"("priority");

CREATE UNIQUE INDEX "study_slot_states_session_id_slot_id_key" ON "study_slot_states"("session_id", "slot_id");
CREATE INDEX "study_slot_states_session_id_idx" ON "study_slot_states"("session_id");
CREATE INDEX "study_slot_states_slot_id_idx" ON "study_slot_states"("slot_id");
CREATE INDEX "study_slot_states_status_idx" ON "study_slot_states"("status");
CREATE INDEX "study_slot_states_source_type_idx" ON "study_slot_states"("source_type");

CREATE INDEX "study_slot_evidence_slot_state_id_idx" ON "study_slot_evidence"("slot_state_id");
CREATE INDEX "study_slot_evidence_utterance_id_idx" ON "study_slot_evidence"("utterance_id");
CREATE INDEX "study_slot_evidence_evidence_type_idx" ON "study_slot_evidence"("evidence_type");

CREATE UNIQUE INDEX "session_metrics_session_id_key" ON "session_metrics"("session_id");
CREATE UNIQUE INDEX "topic_metrics_topic_trial_id_key" ON "topic_metrics"("topic_trial_id");
CREATE UNIQUE INDEX "intervention_effects_intervention_id_key" ON "intervention_effects"("intervention_id");
CREATE UNIQUE INDEX "nasa_tlx_responses_session_id_key" ON "nasa_tlx_responses"("session_id");
CREATE INDEX "nasa_tlx_responses_source_idx" ON "nasa_tlx_responses"("source");
CREATE UNIQUE INDEX "dialogue_evaluation_responses_session_id_key" ON "dialogue_evaluation_responses"("session_id");
CREATE INDEX "dialogue_evaluation_responses_source_idx" ON "dialogue_evaluation_responses"("source");
CREATE UNIQUE INDEX "minutes_evaluations_final_minute_id_key" ON "minutes_evaluations"("final_minute_id");
CREATE INDEX "minutes_evaluations_study_session_id_idx" ON "minutes_evaluations"("study_session_id");
CREATE INDEX "session_auxiliary_items_session_id_idx" ON "session_auxiliary_items"("session_id");
CREATE INDEX "session_auxiliary_items_item_name_idx" ON "session_auxiliary_items"("item_name");

ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_app_session_id_fkey" FOREIGN KEY ("app_session_id") REFERENCES "sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_sessions" ADD CONSTRAINT "study_sessions_experiment_session_id_fkey" FOREIGN KEY ("experiment_session_id") REFERENCES "ExperimentSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_topic_trials" ADD CONSTRAINT "study_topic_trials_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_topic_trials" ADD CONSTRAINT "study_topic_trials_legacy_topic_log_id_fkey" FOREIGN KEY ("legacy_topic_log_id") REFERENCES "TopicLog"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_utterances" ADD CONSTRAINT "study_utterances_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_utterances" ADD CONSTRAINT "study_utterances_topic_trial_id_fkey" FOREIGN KEY ("topic_trial_id") REFERENCES "study_topic_trials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_utterances" ADD CONSTRAINT "study_utterances_app_utterance_id_fkey" FOREIGN KEY ("app_utterance_id") REFERENCES "utterances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_utterances" ADD CONSTRAINT "study_utterances_legacy_utterance_id_fkey" FOREIGN KEY ("legacy_utterance_id") REFERENCES "Utterance"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_interventions" ADD CONSTRAINT "study_interventions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_interventions" ADD CONSTRAINT "study_interventions_topic_trial_id_fkey" FOREIGN KEY ("topic_trial_id") REFERENCES "study_topic_trials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_interventions" ADD CONSTRAINT "study_interventions_app_suggestion_id_fkey" FOREIGN KEY ("app_suggestion_id") REFERENCES "ai_suggestions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_interventions" ADD CONSTRAINT "study_interventions_button_event_id_fkey" FOREIGN KEY ("button_event_id") REFERENCES "button_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_interventions" ADD CONSTRAINT "study_interventions_legacy_intervention_id_fkey" FOREIGN KEY ("legacy_intervention_id") REFERENCES "Intervention"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "study_slot_states" ADD CONSTRAINT "study_slot_states_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_slot_states" ADD CONSTRAINT "study_slot_states_slot_id_fkey" FOREIGN KEY ("slot_id") REFERENCES "acp_slot_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "study_slot_evidence" ADD CONSTRAINT "study_slot_evidence_slot_state_id_fkey" FOREIGN KEY ("slot_state_id") REFERENCES "study_slot_states"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "study_slot_evidence" ADD CONSTRAINT "study_slot_evidence_utterance_id_fkey" FOREIGN KEY ("utterance_id") REFERENCES "study_utterances"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "session_metrics" ADD CONSTRAINT "session_metrics_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "topic_metrics" ADD CONSTRAINT "topic_metrics_topic_trial_id_fkey" FOREIGN KEY ("topic_trial_id") REFERENCES "study_topic_trials"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "intervention_effects" ADD CONSTRAINT "intervention_effects_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "study_interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "nasa_tlx_responses" ADD CONSTRAINT "nasa_tlx_responses_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dialogue_evaluation_responses" ADD CONSTRAINT "dialogue_evaluation_responses_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "minutes_evaluations" ADD CONSTRAINT "minutes_evaluations_final_minute_id_fkey" FOREIGN KEY ("final_minute_id") REFERENCES "final_minutes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "minutes_evaluations" ADD CONSTRAINT "minutes_evaluations_study_session_id_fkey" FOREIGN KEY ("study_session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "session_auxiliary_items" ADD CONSTRAINT "session_auxiliary_items_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "study_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "acp_slot_definitions" ("id", "label", "category", "priority", "active")
VALUES
  ('価値観', '価値観', 'acp', 1, true),
  ('今後の生活希望', '今後の生活希望', 'acp', 2, true),
  ('介護希望', '介護希望', 'acp', 3, true),
  ('医療処置への希望', '医療処置への希望', 'acp', 4, true),
  ('延命治療への考え', '延命治療への考え', 'acp', 5, true),
  ('最期を迎えたい場所', '最期を迎えたい場所', 'acp', 6, true),
  ('代理意思決定者', '代理意思決定者', 'acp', 7, true),
  ('家族に伝えたいこと', '家族に伝えたいこと', 'acp', 8, true),
  ('不安・心配', '不安・心配', 'acp', 9, true)
ON CONFLICT ("id") DO UPDATE SET
  "label" = EXCLUDED."label",
  "category" = EXCLUDED."category",
  "priority" = EXCLUDED."priority",
  "active" = EXCLUDED."active";
