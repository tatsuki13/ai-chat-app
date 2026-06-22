-- Baseline the default Neon sample table that already exists in this database.
-- Fresh databases will create it; the current Neon database is marked as applied
-- with `prisma migrate resolve` to avoid dropping existing data.
CREATE TABLE "playing_with_neon" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "value" REAL,

    CONSTRAINT "playing_with_neon_pkey" PRIMARY KEY ("id")
);
