CREATE TYPE "AiDisclosureLevel" AS ENUM ('UNDECLARED', 'NONE', 'PARTLY', 'ALL');

ALTER TABLE "Track"
ADD COLUMN "aiDisclosureLevel" "AiDisclosureLevel" NOT NULL DEFAULT 'UNDECLARED',
ADD COLUMN "aiContributionFacets" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "aiDisclosureSource" TEXT NOT NULL DEFAULT 'migration',
ADD COLUMN "aiDisclosureVersion" TEXT,
ADD COLUMN "aiDeclaredAt" TIMESTAMP(3);

CREATE INDEX "Track_aiDisclosureLevel_idx" ON "Track"("aiDisclosureLevel");

UPDATE "Track" AS track
SET
  "aiDisclosureLevel" = 'ALL',
  "aiDisclosureSource" = 'resonate_native',
  "aiDisclosureVersion" = 'ddex-ern-4.3.2-resonate-v1',
  "aiDeclaredAt" = COALESCE(track."createdAt", CURRENT_TIMESTAMP)
FROM "Release" AS release
WHERE track."releaseId" = release."id"
  AND release."type" = 'ai_generated';

UPDATE "Track" AS track
SET
  "aiDisclosureLevel" = CASE track."generationMetadata"->>'grounding'
    WHEN 'stem_audio' THEN 'NONE'::"AiDisclosureLevel"
    WHEN 'prompt_only' THEN 'ALL'::"AiDisclosureLevel"
    ELSE 'PARTLY'::"AiDisclosureLevel"
  END,
  "aiContributionFacets" = CASE track."generationMetadata"->>'grounding'
    WHEN 'stem_audio' THEN ARRAY[]::TEXT[]
    WHEN 'prompt_only' THEN ARRAY[]::TEXT[]
    ELSE ARRAY['production']::TEXT[]
  END,
  "aiDisclosureSource" = 'remix_derived',
  "aiDisclosureVersion" = 'ddex-ern-4.3.2-resonate-v1',
  "aiDeclaredAt" = COALESCE(track."createdAt", CURRENT_TIMESTAMP)
FROM "Release" AS release
WHERE track."releaseId" = release."id"
  AND release."type" = 'remix'
  AND track."generationMetadata"->>'grounding' IN (
    'stem_audio',
    'stem_plus_ai',
    'audio_conditioned',
    'feature_conditioned',
    'prompt_only'
  );
