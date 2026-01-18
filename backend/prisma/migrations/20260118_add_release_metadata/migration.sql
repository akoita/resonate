-- Add release metadata fields to tracks
ALTER TABLE "Track"
ADD COLUMN "releaseType" TEXT NOT NULL DEFAULT 'single',
ADD COLUMN "releaseTitle" TEXT,
ADD COLUMN "primaryArtist" TEXT,
ADD COLUMN "featuredArtists" TEXT,
ADD COLUMN "genre" TEXT,
ADD COLUMN "isrc" TEXT,
ADD COLUMN "label" TEXT,
ADD COLUMN "releaseDate" TIMESTAMP,
ADD COLUMN "explicit" BOOLEAN NOT NULL DEFAULT FALSE;
