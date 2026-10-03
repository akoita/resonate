-- Settled purchases are an engagement input for discovery popularity (#1450).
ALTER TABLE "TrackPopularity"
ADD COLUMN "purchases" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "ArtistEngagement"
ADD COLUMN "purchases" INTEGER NOT NULL DEFAULT 0;
