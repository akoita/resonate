/*
  Warnings:

  - You are about to drop the column `commercialMultiplier` on the `StemPricing` table. All the data in the column will be lost.
  - You are about to drop the column `remixSurchargeMultiplier` on the `StemPricing` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "StemPricing" DROP COLUMN "commercialMultiplier",
DROP COLUMN "remixSurchargeMultiplier",
ADD COLUMN     "commercialLicenseUsd" DOUBLE PRECISION NOT NULL DEFAULT 25.0,
ADD COLUMN     "remixLicenseUsd" DOUBLE PRECISION NOT NULL DEFAULT 5.0;
