-- #2669: composition details per track (writers, publisher, ISWC, cover/samples).
CREATE TABLE "TrackComposition" (
    "trackId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "writers" JSONB NOT NULL DEFAULT '[]',
    "publisher" VARCHAR(200),
    "selfPublished" BOOLEAN NOT NULL DEFAULT false,
    "iswc" VARCHAR(11),
    "coverOrSamples" BOOLEAN NOT NULL DEFAULT false,
    "coverNote" VARCHAR(1000),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackComposition_pkey" PRIMARY KEY ("trackId")
);

CREATE INDEX "TrackComposition_artistId_idx" ON "TrackComposition"("artistId");

ALTER TABLE "TrackComposition" ADD CONSTRAINT "TrackComposition_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;
