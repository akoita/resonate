-- AlterTable
ALTER TABLE "Stem" ADD COLUMN     "data" BYTEA,
ADD COLUMN     "mimeType" TEXT;

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "artworkData" BYTEA,
ADD COLUMN     "artworkMimeType" TEXT;
