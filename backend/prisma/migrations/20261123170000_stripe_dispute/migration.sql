-- #2596: card disputes (chargebacks) reported by Stripe.
CREATE TABLE "StripeDispute" (
    "id" TEXT NOT NULL,
    "stripeDisputeId" TEXT NOT NULL,
    "stripeChargeId" TEXT,
    "stripePaymentIntentId" TEXT,
    "kind" TEXT NOT NULL,
    "creditTopUpId" TEXT,
    "currency" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" VARCHAR(64),
    "status" TEXT NOT NULL,
    "statusBefore" TEXT,
    "disputedCreditsCents" INTEGER NOT NULL DEFAULT 0,
    "heldCents" INTEGER NOT NULL DEFAULT 0,
    "releasedCents" INTEGER NOT NULL DEFAULT 0,
    "holdAppliedAt" TIMESTAMP(3),
    "withdrawnCents" INTEGER NOT NULL DEFAULT 0,
    "feeCents" INTEGER NOT NULL DEFAULT 0,
    "reinstatedCents" INTEGER NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "fundsReinstatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StripeDispute_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StripeDispute_stripeDisputeId_key" ON "StripeDispute"("stripeDisputeId");
CREATE INDEX "StripeDispute_creditTopUpId_status_idx" ON "StripeDispute"("creditTopUpId", "status");
CREATE INDEX "StripeDispute_openedAt_idx" ON "StripeDispute"("openedAt");
CREATE INDEX "StripeDispute_closedAt_idx" ON "StripeDispute"("closedAt");
CREATE INDEX "StripeDispute_fundsReinstatedAt_idx" ON "StripeDispute"("fundsReinstatedAt");

ALTER TABLE "StripeDispute" ADD CONSTRAINT "StripeDispute_creditTopUpId_fkey" FOREIGN KEY ("creditTopUpId") REFERENCES "CreditTopUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;
