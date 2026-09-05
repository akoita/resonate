-- Discovery popularity serving tables (#1450 contract / #1451 interim filler).

-- CreateTable
CREATE TABLE "TrackPopularity" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "genre" TEXT NOT NULL DEFAULT '',
    "score" DOUBLE PRECISION NOT NULL,
    "plays" INTEGER NOT NULL,
    "uniqueListeners" INTEGER NOT NULL,
    "saves" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackPopularity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistEngagement" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "window" TEXT NOT NULL,
    "genre" TEXT NOT NULL DEFAULT '',
    "score" DOUBLE PRECISION NOT NULL,
    "plays" INTEGER NOT NULL,
    "uniqueListeners" INTEGER NOT NULL,
    "saves" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ArtistEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TrackPopularity_trackId_window_genre_key" ON "TrackPopularity"("trackId", "window", "genre");
CREATE INDEX "TrackPopularity_window_genre_score_idx" ON "TrackPopularity"("window", "genre", "score");
CREATE UNIQUE INDEX "ArtistEngagement_artistId_window_genre_key" ON "ArtistEngagement"("artistId", "window", "genre");
CREATE INDEX "ArtistEngagement_window_genre_score_idx" ON "ArtistEngagement"("window", "genre", "score");
