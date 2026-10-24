-- #1976 (ADR-TE-7): every stem records where its audio comes from. Stems the
-- ingestion worker separated from the uploaded mix are `separated` (with the
-- model); artists can upload `official` lossless stems. The full-mix rows
-- (`original`, remix `master`) are not stems a buyer licenses and keep a NULL
-- source. Additive: no existing value changes and no existing row is removed.

-- CreateEnum
CREATE TYPE "StemSource" AS ENUM ('separated', 'official');

-- AlterTable
ALTER TABLE "Stem"
  ADD COLUMN "source" "StemSource",
  ADD COLUMN "separationModel" TEXT;

-- Backfill: every existing non-mix stem was separated by Demucs htdemucs_6s
-- (docs/features/artist_upload_flow_mvp.md); original and master rows stay NULL.
UPDATE "Stem"
SET "source" = 'separated',
    "separationModel" = 'demucs-htdemucs-6s'
WHERE lower("type") NOT IN ('original', 'master');

-- CreateIndex
CREATE INDEX "Stem_source_idx" ON "Stem"("source");
