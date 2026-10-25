-- #2406 (Artist Pro slice 1): operator and promo grants of the `pro` plan.
-- Additive: a new table and two enums; no existing value changes. Under policy
-- `entitlements/v1` (`everyone`) a grant is recorded in each entitlement
-- decision but changes nothing a person can do.

-- CreateEnum
CREATE TYPE "EntitlementGrantPlan" AS ENUM ('pro');

-- CreateEnum
CREATE TYPE "EntitlementGrantSource" AS ENUM ('operator_grant', 'promo');

-- CreateTable
CREATE TABLE "EntitlementGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "plan" "EntitlementGrantPlan" NOT NULL DEFAULT 'pro',
    "source" "EntitlementGrantSource" NOT NULL DEFAULT 'operator_grant',
    "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validUntil" TIMESTAMP(3),
    "reason" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,

    CONSTRAINT "EntitlementGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EntitlementGrant_userId_revokedAt_idx" ON "EntitlementGrant"("userId", "revokedAt");

-- AddForeignKey
ALTER TABLE "EntitlementGrant" ADD CONSTRAINT "EntitlementGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
