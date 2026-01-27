-- AlterTable
ALTER TABLE "Stem" ADD COLUMN     "artist" TEXT,
ADD COLUMN     "artworkUrl" TEXT,
ADD COLUMN     "title" TEXT;

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "artworkUrl" TEXT;
