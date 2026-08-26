CREATE TABLE "ai_processing_states" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "last_processed_utterance_id" TEXT,
  "last_processed_at" TIMESTAMP(3),
  "slot_revision" INTEGER NOT NULL DEFAULT 0,
  "processing_status" TEXT NOT NULL DEFAULT 'idle',
  "processing_started_at" TIMESTAMP(3),
  "processing_finished_at" TIMESTAMP(3),
  "last_error" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ai_processing_states_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prepared_questions" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "topic_id" TEXT NOT NULL,
  "topic_slot_name" TEXT,
  "question" TEXT NOT NULL,
  "transition_phrase" TEXT NOT NULL DEFAULT '',
  "target_main_slot_id" TEXT NOT NULL,
  "target_sub_slot_id" TEXT NOT NULL,
  "question_purpose" TEXT NOT NULL,
  "reason_for_selection" TEXT NOT NULL,
  "based_on_utterance_id" TEXT,
  "slot_revision" INTEGER NOT NULL,
  "status" TEXT NOT NULL,
  "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "displayed_at" TIMESTAMP(3),
  "invalidated_at" TIMESTAMP(3),
  "invalidation_reason" TEXT,
  "expires_at" TIMESTAMP(3),
  "display_log_committed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "prepared_questions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ai_processing_states_session_id_key" ON "ai_processing_states"("session_id");
CREATE INDEX "ai_processing_states_participant_code_idx" ON "ai_processing_states"("participant_code");
CREATE INDEX "ai_processing_states_processing_status_idx" ON "ai_processing_states"("processing_status");
CREATE INDEX "ai_processing_states_updated_at_idx" ON "ai_processing_states"("updated_at");
CREATE INDEX "prepared_questions_session_id_topic_id_status_idx" ON "prepared_questions"("session_id", "topic_id", "status");
CREATE INDEX "prepared_questions_session_id_status_idx" ON "prepared_questions"("session_id", "status");
CREATE INDEX "prepared_questions_participant_code_idx" ON "prepared_questions"("participant_code");
CREATE INDEX "prepared_questions_generated_at_idx" ON "prepared_questions"("generated_at");

ALTER TABLE "ai_processing_states"
  ADD CONSTRAINT "ai_processing_states_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prepared_questions"
  ADD CONSTRAINT "prepared_questions_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
