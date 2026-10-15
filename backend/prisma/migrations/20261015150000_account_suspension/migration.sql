-- #2147 operator account suspension and closure.

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('active', 'suspended', 'closed');

-- CreateEnum
CREATE TYPE "AccountStatusReason" AS ENUM ('terms_violation', 'fraud', 'abuse', 'rights_infringement', 'other');

-- AlterTable
ALTER TABLE "User"
    ADD COLUMN "accountStatus" "AccountStatus" NOT NULL DEFAULT 'active',
    ADD COLUMN "accountStatusReason" "AccountStatusReason",
    ADD COLUMN "accountStatusUntil" TIMESTAMP(3),
    ADD COLUMN "accountStatusChangedAt" TIMESTAMP(3),
    ADD COLUMN "accountStatusChangedBy" TEXT;
