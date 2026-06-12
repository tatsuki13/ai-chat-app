-- CreateTable
CREATE TABLE "ExperimentSession" (
    "id" TEXT NOT NULL,
    "condition" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "presetTopicDurationMs" INTEGER,
    "silenceSoftThresholdMs" INTEGER,
    "silenceInterventionThresholdMs" INTEGER,
    "maxSilenceInterventionsPerTopic" INTEGER,
    "rawLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExperimentSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TopicLog" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "topicIndex" INTEGER NOT NULL,
    "level" INTEGER,
    "lead" TEXT,
    "question" TEXT NOT NULL,
    "acpSlots" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expressedPoints" JSONB,
    "missingOrUnclearSlots" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "slotEvidence" JSONB,
    "presentedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "firstUtteranceAt" TIMESTAMP(3),
    "latencyToFirstUtteranceMs" INTEGER,
    "endReason" TEXT,
    "interventionCount" INTEGER NOT NULL DEFAULT 0,
    "silenceInterventionCount" INTEGER NOT NULL DEFAULT 0,
    "utteranceCountUser" INTEGER NOT NULL DEFAULT 0,
    "utteranceCountPartner" INTEGER NOT NULL DEFAULT 0,
    "totalUserCharCount" INTEGER NOT NULL DEFAULT 0,
    "totalPartnerCharCount" INTEGER NOT NULL DEFAULT 0,
    "firstUtteranceDetected" BOOLEAN NOT NULL DEFAULT false,
    "lastHumanUtteranceEndAt" TIMESTAMP(3),
    "currentState" TEXT,
    "stateHistory" JSONB,
    "silenceEvents" JSONB,
    "rawLog" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TopicLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Utterance" (
    "id" TEXT NOT NULL,
    "topicLogId" TEXT NOT NULL,
    "speaker" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "messageId" INTEGER,
    "charCount" INTEGER,
    "rawEntry" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Utterance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Intervention" (
    "id" TEXT NOT NULL,
    "topicLogId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "interventionNumber" INTEGER,
    "promptedSlot" TEXT,
    "aiReflectionText" TEXT NOT NULL,
    "silenceDurationMs" INTEGER,
    "expressedPoints" JSONB,
    "source" TEXT,
    "messageId" INTEGER,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "rawEntry" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Intervention_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ExperimentSession_condition_idx" ON "ExperimentSession"("condition");

-- CreateIndex
CREATE INDEX "ExperimentSession_startedAt_idx" ON "ExperimentSession"("startedAt");

-- CreateIndex
CREATE INDEX "TopicLog_sessionId_idx" ON "TopicLog"("sessionId");

-- CreateIndex
CREATE INDEX "TopicLog_topicId_idx" ON "TopicLog"("topicId");

-- CreateIndex
CREATE UNIQUE INDEX "TopicLog_sessionId_topicIndex_key" ON "TopicLog"("sessionId", "topicIndex");

-- CreateIndex
CREATE INDEX "Utterance_topicLogId_idx" ON "Utterance"("topicLogId");

-- CreateIndex
CREATE INDEX "Utterance_speaker_idx" ON "Utterance"("speaker");

-- CreateIndex
CREATE INDEX "Utterance_timestamp_idx" ON "Utterance"("timestamp");

-- CreateIndex
CREATE INDEX "Intervention_topicLogId_idx" ON "Intervention"("topicLogId");

-- CreateIndex
CREATE INDEX "Intervention_reason_idx" ON "Intervention"("reason");

-- CreateIndex
CREATE INDEX "Intervention_timestamp_idx" ON "Intervention"("timestamp");

-- AddForeignKey
ALTER TABLE "TopicLog" ADD CONSTRAINT "TopicLog_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "ExperimentSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Utterance" ADD CONSTRAINT "Utterance_topicLogId_fkey" FOREIGN KEY ("topicLogId") REFERENCES "TopicLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Intervention" ADD CONSTRAINT "Intervention_topicLogId_fkey" FOREIGN KEY ("topicLogId") REFERENCES "TopicLog"("id") ON DELETE CASCADE ON UPDATE CASCADE;
