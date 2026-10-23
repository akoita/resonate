-- #2240 enriched track descriptors: one derived, versioned descriptor per track
-- (genre families, sub-genres, measured bands, vocal/instrumental), recomputed
-- only when its content hash changes. `source` leaves room for artist
-- corrections (#2292) without another migration.

-- CreateTable
CREATE TABLE "TrackDescriptor" (
    "trackId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "families" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "subGenres" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tempoBand" TEXT,
    "energyBand" TEXT,
    "vocal" TEXT,
    "source" TEXT NOT NULL,
    "model" TEXT,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackDescriptor_pkey" PRIMARY KEY ("trackId")
);

-- CreateIndex
CREATE INDEX "TrackDescriptor_families_idx" ON "TrackDescriptor" USING GIN ("families");

-- AddForeignKey
ALTER TABLE "TrackDescriptor" ADD CONSTRAINT "TrackDescriptor_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
