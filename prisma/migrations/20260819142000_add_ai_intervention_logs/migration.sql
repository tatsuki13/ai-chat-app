CREATE TABLE "ai_intervention_logs" (
  "id" TEXT NOT NULL,
  "session_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "topic_id" TEXT,
  "requested_at" TIMESTAMP(3),
  "generated_at" TIMESTAMP(3) NOT NULL,
  "displayed_at" TIMESTAMP(3),
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ai_intervention_logs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ai_intervention_logs_session_id_generated_at_idx" ON "ai_intervention_logs"("session_id", "generated_at");
CREATE INDEX "ai_intervention_logs_session_id_type_idx" ON "ai_intervention_logs"("session_id", "type");
CREATE INDEX "ai_intervention_logs_topic_id_idx" ON "ai_intervention_logs"("topic_id");
CREATE INDEX "ai_intervention_logs_created_at_idx" ON "ai_intervention_logs"("created_at");

ALTER TABLE "ai_intervention_logs"
  ADD CONSTRAINT "ai_intervention_logs_session_id_fkey"
  FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
