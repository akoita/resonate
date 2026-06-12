-- Measured stem musical features extracted by the demucs worker (#1184).
-- Additive and nullable: existing rows are untouched.
ALTER TABLE "Stem" ADD COLUMN "audioFeatures" JSONB;
