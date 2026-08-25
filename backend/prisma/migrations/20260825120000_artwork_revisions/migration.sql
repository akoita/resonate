-- Version mutable release artwork and Shows campaign visuals for cache-coherent URLs.
ALTER TABLE "Release"
  ADD COLUMN "artworkRevision" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "ShowCampaignVisual"
  ADD COLUMN "artworkRevision" INTEGER NOT NULL DEFAULT 1;
