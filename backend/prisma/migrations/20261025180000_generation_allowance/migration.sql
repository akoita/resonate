-- #2408 (Artist Pro slice 3): the monthly generation allowance bucket.
-- Additive: one new table and two new ledger columns with defaults. Existing
-- ledger rows keep `allowanceCents = 0` (they moved the bought/promo balance
-- only), so every balance and audit sum is unchanged.

-- AlterTable
ALTER TABLE "GenerationCreditTransaction" ADD COLUMN "allowanceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "allowanceGrantId" TEXT;

-- CreateTable
CREATE TABLE "GenerationAllowanceGrant" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "sliceIndex" INTEGER NOT NULL DEFAULT 0,
    "amountCents" INTEGER NOT NULL,
    "consumedCents" INTEGER NOT NULL DEFAULT 0,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationAllowanceGrant_pkey" PRIMARY KEY ("id"),
    -- A bucket never goes negative and never spends more than it was granted.
    CONSTRAINT "GenerationAllowanceGrant_consumed_check" CHECK ("amountCents" >= 0 AND "consumedCents" >= 0 AND "consumedCents" <= "amountCents")
);

-- CreateIndex
CREATE INDEX "GenerationCreditTransaction_allowanceGrantId_idx" ON "GenerationCreditTransaction"("allowanceGrantId");

-- CreateIndex
CREATE INDEX "GenerationAllowanceGrant_subscriptionId_periodStart_idx" ON "GenerationAllowanceGrant"("subscriptionId", "periodStart");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationAllowanceGrant_stripeInvoiceId_sliceIndex_key" ON "GenerationAllowanceGrant"("stripeInvoiceId", "sliceIndex");

-- CreateIndex
CREATE UNIQUE INDEX "GenerationAllowanceGrant_userId_periodStart_key" ON "GenerationAllowanceGrant"("userId", "periodStart");

-- AddForeignKey
ALTER TABLE "GenerationCreditTransaction" ADD CONSTRAINT "GenerationCreditTransaction_allowanceGrantId_fkey" FOREIGN KEY ("allowanceGrantId") REFERENCES "GenerationAllowanceGrant"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationAllowanceGrant" ADD CONSTRAINT "GenerationAllowanceGrant_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationAllowanceGrant" ADD CONSTRAINT "GenerationAllowanceGrant_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
