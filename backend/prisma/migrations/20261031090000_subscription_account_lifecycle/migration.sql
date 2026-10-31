-- #2430: account erasure and closure cancel the live Stripe subscription first,
-- suspension pauses collection, the billing email follows the confirmed contact
-- address, and processed StripeEvent rows are pruned. Additive: one enum, new
-- nullable or defaulted columns, two indexes; no existing value changes.

-- CreateEnum
CREATE TYPE "SubscriptionEndReason" AS ENUM ('account_erasure', 'account_closure');

-- AlterTable
ALTER TABLE "Subscription" ADD COLUMN     "billingEmailStale" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "closureRequestId" TEXT,
ADD COLUMN     "collectionPausedAt" TIMESTAMP(3),
ADD COLUMN     "endAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "endConfirmedAt" TIMESTAMP(3),
ADD COLUMN     "endLastError" VARCHAR(64),
ADD COLUMN     "endReason" "SubscriptionEndReason",
ADD COLUMN     "endRequestedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Subscription_billingEmailStale_idx" ON "Subscription"("billingEmailStale");

-- CreateIndex
CREATE INDEX "StripeEvent_processedAt_idx" ON "StripeEvent"("processedAt");
