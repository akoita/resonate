-- CreateEnum
CREATE TYPE "LicenseType" AS ENUM ('personal', 'remix', 'commercial', 'sync', 'sample', 'broadcast');

-- AlterTable
ALTER TABLE "StemPurchase" ADD COLUMN     "licenseType" "LicenseType" NOT NULL DEFAULT 'personal';

-- CreateIndex
CREATE INDEX "StemPurchase_licenseType_idx" ON "StemPurchase"("licenseType");
