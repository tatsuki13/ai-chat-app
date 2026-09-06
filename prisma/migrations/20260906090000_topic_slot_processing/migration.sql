ALTER TABLE "utterances"
  ADD COLUMN "topic_id" TEXT,
  ADD COLUMN "topic_index" INTEGER;

CREATE INDEX "utterances_session_id_topic_id_idx"
  ON "utterances"("session_id", "topic_id");

CREATE TABLE "slot_processing_states" (
  "id" TEXT NOT NULL,
  "participant_code" TEXT,
  "session_id" TEXT NOT NULL,
  "topic_id" TEXT NOT NULL,
  "last_processed_utterance_id" TEXT,
  "last_processed_at" TIMESTAMP(3),
  "processing_range_end_utterance_id" TEXT,
  "processing_range_started_at" TIMESTAMP(3),
  "slot_revision" INTEGER NOT NULL DEFAULT 0,
  "processing_status" TEXT NOT NULL DEFAULT 'idle',
  "processing_started_at" TIMESTAMP(3),
  "processing_finished_at" TIMESTAMP(3),
  "last_error" TEXT,
  "retry_count" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "slot_processing_states_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "slot_processing_states"
  ADD CONSTRAINT "slot_processing_states_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE UNIQUE INDEX "slot_processing_states_session_id_topic_id_key"
  ON "slot_processing_states"("session_id", "topic_id");

CREATE INDEX "slot_processing_states_session_id_idx"
  ON "slot_processing_states"("session_id");

CREATE INDEX "slot_processing_states_participant_code_idx"
  ON "slot_processing_states"("participant_code");

CREATE INDEX "slot_processing_states_topic_id_idx"
  ON "slot_processing_states"("topic_id");

CREATE INDEX "slot_processing_states_processing_status_idx"
  ON "slot_processing_states"("processing_status");

CREATE INDEX "slot_processing_states_updated_at_idx"
  ON "slot_processing_states"("updated_at");
