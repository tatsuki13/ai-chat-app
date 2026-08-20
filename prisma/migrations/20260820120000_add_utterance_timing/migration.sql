ALTER TABLE "utterances"
ADD COLUMN "start_ms" INTEGER,
ADD COLUMN "end_ms" INTEGER,
ADD COLUMN "source" TEXT,
ADD COLUMN "analysis_version" TEXT;

ALTER TABLE "utterances"
ADD CONSTRAINT "utterances_valid_timing"
CHECK (
  ("start_ms" IS NULL AND "end_ms" IS NULL)
  OR
  (
    "start_ms" IS NOT NULL
    AND "end_ms" IS NOT NULL
    AND "start_ms" >= 0
    AND "end_ms" >= "start_ms"
  )
);

CREATE INDEX "utterances_session_id_start_ms_idx"
ON "utterances"("session_id", "start_ms");
