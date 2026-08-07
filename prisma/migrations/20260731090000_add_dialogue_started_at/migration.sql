ALTER TABLE "sessions" ADD COLUMN "dialogue_started_at" TIMESTAMP(3);

CREATE INDEX "sessions_dialogue_started_at_idx" ON "sessions"("dialogue_started_at");
