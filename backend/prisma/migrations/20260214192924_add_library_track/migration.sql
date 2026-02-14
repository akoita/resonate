-- CreateTable
CREATE TABLE "LibraryTrack" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'local',
    "title" TEXT NOT NULL,
    "artist" TEXT,
    "albumArtist" TEXT,
    "album" TEXT,
    "year" INTEGER,
    "genre" TEXT,
    "duration" DOUBLE PRECISION,
    "sourcePath" TEXT,
    "fileSize" INTEGER,
    "catalogTrackId" TEXT,
    "remoteUrl" TEXT,
    "remoteArtworkUrl" TEXT,
    "stemType" TEXT,
    "tokenId" TEXT,
    "listingId" TEXT,
    "purchaseDate" TIMESTAMP(3),
    "isOwned" BOOLEAN NOT NULL DEFAULT false,
    "previewUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LibraryTrack_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LibraryTrack_userId_idx" ON "LibraryTrack"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryTrack_userId_sourcePath_fileSize_key" ON "LibraryTrack"("userId", "sourcePath", "fileSize");

-- CreateIndex
CREATE UNIQUE INDEX "LibraryTrack_userId_catalogTrackId_key" ON "LibraryTrack"("userId", "catalogTrackId");

-- AddForeignKey
ALTER TABLE "LibraryTrack" ADD CONSTRAINT "LibraryTrack_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
