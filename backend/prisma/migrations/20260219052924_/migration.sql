/*
  Warnings:

  - You are about to drop the `StemQualityRating` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "StemQualityRating" DROP CONSTRAINT "StemQualityRating_stemId_fkey";

-- AlterTable
ALTER TABLE "Track" ADD COLUMN     "generationMetadata" JSONB;

-- DropTable
DROP TABLE "StemQualityRating";
