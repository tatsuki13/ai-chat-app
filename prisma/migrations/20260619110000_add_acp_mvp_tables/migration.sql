-- CreateTable
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "participant_code" TEXT,
    "condition" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "utterances" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "utterances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "button_events" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "button_type" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "button_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_suggestions" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "trigger_event_id" TEXT,
    "suggestion_type" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "reasoning" TEXT,
    "target_slot" TEXT,
    "adopted" BOOLEAN,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_suggestions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "slot_states" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "slot_name" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence_utterance" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "slot_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "final_minutes" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "markdown" TEXT NOT NULL,
    "json" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "final_minutes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "sessions_participant_code_idx" ON "sessions"("participant_code");

-- CreateIndex
CREATE INDEX "sessions_started_at_idx" ON "sessions"("started_at");

-- CreateIndex
CREATE INDEX "utterances_session_id_idx" ON "utterances"("session_id");

-- CreateIndex
CREATE INDEX "utterances_speaker_idx" ON "utterances"("speaker");

-- CreateIndex
CREATE INDEX "utterances_created_at_idx" ON "utterances"("created_at");

-- CreateIndex
CREATE INDEX "button_events_session_id_idx" ON "button_events"("session_id");

-- CreateIndex
CREATE INDEX "button_events_button_type_idx" ON "button_events"("button_type");

-- CreateIndex
CREATE INDEX "button_events_created_at_idx" ON "button_events"("created_at");

-- CreateIndex
CREATE INDEX "ai_suggestions_session_id_idx" ON "ai_suggestions"("session_id");

-- CreateIndex
CREATE INDEX "ai_suggestions_trigger_event_id_idx" ON "ai_suggestions"("trigger_event_id");

-- CreateIndex
CREATE INDEX "ai_suggestions_suggestion_type_idx" ON "ai_suggestions"("suggestion_type");

-- CreateIndex
CREATE INDEX "ai_suggestions_created_at_idx" ON "ai_suggestions"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "slot_states_session_id_slot_name_key" ON "slot_states"("session_id", "slot_name");

-- CreateIndex
CREATE INDEX "slot_states_session_id_idx" ON "slot_states"("session_id");

-- CreateIndex
CREATE INDEX "slot_states_status_idx" ON "slot_states"("status");

-- CreateIndex
CREATE INDEX "final_minutes_session_id_idx" ON "final_minutes"("session_id");

-- CreateIndex
CREATE INDEX "final_minutes_created_at_idx" ON "final_minutes"("created_at");

-- AddForeignKey
ALTER TABLE "utterances" ADD CONSTRAINT "utterances_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "button_events" ADD CONSTRAINT "button_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_suggestions" ADD CONSTRAINT "ai_suggestions_trigger_event_id_fkey" FOREIGN KEY ("trigger_event_id") REFERENCES "button_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "slot_states" ADD CONSTRAINT "slot_states_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "final_minutes" ADD CONSTRAINT "final_minutes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
