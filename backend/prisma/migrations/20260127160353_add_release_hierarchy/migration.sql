/*
  Warnings:

  - You are about to drop the column `artistId` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `artworkData` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `artworkMimeType` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `artworkUrl` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `featuredArtists` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `genre` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `label` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `primaryArtist` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `releaseDate` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `releaseTitle` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `releaseType` on the `Track` table. All the data in the column will be lost.
  - You are about to drop the column `status` on the `Track` table. All the data in the column will be lost.
  - Added the required column `releaseId` to the `Track` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "Track" DROP CONSTRAINT "Track_artistId_fkey";

-- AlterTable
ALTER TABLE "Track" DROP COLUMN "artistId",
DROP COLUMN "artworkData",
DROP COLUMN "artworkMimeType",
DROP COLUMN "artworkUrl",
DROP COLUMN "featuredArtists",
DROP COLUMN "genre",
DROP COLUMN "label",
DROP COLUMN "primaryArtist",
DROP COLUMN "releaseDate",
DROP COLUMN "releaseTitle",
DROP COLUMN "releaseType",
DROP COLUMN "status",
ADD COLUMN     "position" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "releaseId" TEXT NOT NULL;

-- CreateTable
CREATE TABLE "Release" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'processing',
    "type" TEXT NOT NULL DEFAULT 'single',
    "primaryArtist" TEXT,
    "featuredArtists" TEXT,
    "genre" TEXT,
    "label" TEXT,
    "releaseDate" TIMESTAMP(3),
    "explicit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "artworkUrl" TEXT,
    "artworkData" BYTEA,
    "artworkMimeType" TEXT,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Track" ADD CONSTRAINT "Track_releaseId_fkey" FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
