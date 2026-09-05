-- #479 Punchline Drops (Sprint 7): persistence foundation for artist-curated
-- vocal-stem collectible "moments" (drops, moments, ownership grants, unlocks).
-- Models + enums + relations only; services/APIs land in later workstream issues.

-- CreateEnum
CREATE TYPE "PunchlineDropStatus" AS ENUM ('draft', 'published', 'archived');

-- CreateEnum
CREATE TYPE "PunchlineCollectibleStatus" AS ENUM ('pending', 'owned', 'revoked');

-- CreateEnum
CREATE TYPE "PunchlineUnlockType" AS ENUM ('complete_set');

-- CreateTable
CREATE TABLE "PunchlineDrop" (
    "id" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "status" "PunchlineDropStatus" NOT NULL DEFAULT 'draft',
    "title" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "publishedAt" TIMESTAMP(3),

    CONSTRAINT "PunchlineDrop_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PunchlineMoment" (
    "id" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "lyricText" TEXT NOT NULL,
    "artworkUrl" TEXT,
    "sourceStemType" TEXT NOT NULL DEFAULT 'vocals',
    "startMs" INTEGER NOT NULL,
    "endMs" INTEGER NOT NULL,
    "clipAssetUri" TEXT,
    "editionSize" INTEGER NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "rightsLabel" TEXT NOT NULL DEFAULT 'NON_COMMERCIAL_COLLECTIBLE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PunchlineMoment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PunchlineCollectible" (
    "id" TEXT NOT NULL,
    "momentId" TEXT NOT NULL,
    "collectorUserId" TEXT NOT NULL,
    "collectorWallet" TEXT,
    "editionNumber" INTEGER NOT NULL,
    "status" "PunchlineCollectibleStatus" NOT NULL DEFAULT 'pending',
    "acquiredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PunchlineCollectible_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PunchlineUnlock" (
    "id" TEXT NOT NULL,
    "dropId" TEXT NOT NULL,
    "unlockType" "PunchlineUnlockType" NOT NULL DEFAULT 'complete_set',
    "rewardMetadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PunchlineUnlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PunchlineDrop_trackId_idx" ON "PunchlineDrop"("trackId");

-- CreateIndex
CREATE INDEX "PunchlineDrop_artistId_status_idx" ON "PunchlineDrop"("artistId", "status");

-- CreateIndex
CREATE INDEX "PunchlineMoment_dropId_idx" ON "PunchlineMoment"("dropId");

-- CreateIndex
CREATE INDEX "PunchlineCollectible_collectorUserId_idx" ON "PunchlineCollectible"("collectorUserId");

-- CreateIndex
CREATE UNIQUE INDEX "PunchlineCollectible_momentId_editionNumber_key" ON "PunchlineCollectible"("momentId", "editionNumber");

-- CreateIndex
CREATE INDEX "PunchlineUnlock_dropId_idx" ON "PunchlineUnlock"("dropId");

-- AddForeignKey
ALTER TABLE "PunchlineDrop" ADD CONSTRAINT "PunchlineDrop_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PunchlineDrop" ADD CONSTRAINT "PunchlineDrop_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PunchlineMoment" ADD CONSTRAINT "PunchlineMoment_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "PunchlineDrop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PunchlineCollectible" ADD CONSTRAINT "PunchlineCollectible_momentId_fkey" FOREIGN KEY ("momentId") REFERENCES "PunchlineMoment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PunchlineCollectible" ADD CONSTRAINT "PunchlineCollectible_collectorUserId_fkey" FOREIGN KEY ("collectorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PunchlineUnlock" ADD CONSTRAINT "PunchlineUnlock_dropId_fkey" FOREIGN KEY ("dropId") REFERENCES "PunchlineDrop"("id") ON DELETE CASCADE ON UPDATE CASCADE;

