CREATE TABLE "slot_sub_states" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "main_slot_id" TEXT NOT NULL,
  "sub_slot_id" TEXT NOT NULL,
  "completion" TEXT NOT NULL,
  "response_state" TEXT NOT NULL,
  "reason_code" TEXT,
  "evidence_utterance_ids" JSONB NOT NULL,
  "can_ask_again" BOOLEAN NOT NULL DEFAULT true,
  "is_deferred" BOOLEAN NOT NULL DEFAULT false,
  "last_updated_topic_id" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "slot_sub_states_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "slot_sub_states_session_id_main_slot_id_sub_slot_id_key"
  ON "slot_sub_states"("session_id", "main_slot_id", "sub_slot_id");
CREATE INDEX "slot_sub_states_session_id_idx" ON "slot_sub_states"("session_id");
CREATE INDEX "slot_sub_states_main_slot_id_idx" ON "slot_sub_states"("main_slot_id");
CREATE INDEX "slot_sub_states_sub_slot_id_idx" ON "slot_sub_states"("sub_slot_id");
CREATE INDEX "slot_sub_states_completion_idx" ON "slot_sub_states"("completion");
CREATE INDEX "slot_sub_states_response_state_idx" ON "slot_sub_states"("response_state");
CREATE INDEX "slot_sub_states_reason_code_idx" ON "slot_sub_states"("reason_code");

ALTER TABLE "slot_sub_states"
  ADD CONSTRAINT "slot_sub_states_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
