-- #2497: the monthly billing reconciliation report. Additive: two append-only
-- billing records and one nullable column; no existing value changes.
-- `CreditTopUpRefund` dates each refund of a credit pack, `SubscriptionInvoice`
-- records each paid Artist Pro invoice, and `CreditTopUp.amountTotalCents` is
-- what the buyer was charged, tax included.

-- AlterTable
ALTER TABLE "CreditTopUp" ADD COLUMN     "amountTotalCents" INTEGER;

-- CreateTable
CREATE TABLE "CreditTopUpRefund" (
    "id" TEXT NOT NULL,
    "creditTopUpId" TEXT NOT NULL,
    "cumulativeRefundedAmountCents" INTEGER NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "withdrawnCreditsCents" INTEGER NOT NULL,
    "reversedCents" INTEGER NOT NULL,
    "statusBefore" TEXT NOT NULL,
    "backfilled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CreditTopUpRefund_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionInvoice" (
    "id" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "stripeInvoiceId" TEXT NOT NULL,
    "stripeSubscriptionId" TEXT NOT NULL,
    "currency" TEXT NOT NULL,
    "amountPaidCents" INTEGER NOT NULL,
    "amountExcludingTaxCents" INTEGER,
    "billingReason" TEXT,
    "interval" "SubscriptionInterval" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CreditTopUpRefund_createdAt_idx" ON "CreditTopUpRefund"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopUpRefund_creditTopUpId_cumulativeRefundedAmountCen_key" ON "CreditTopUpRefund"("creditTopUpId", "cumulativeRefundedAmountCents");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionInvoice_stripeInvoiceId_key" ON "SubscriptionInvoice"("stripeInvoiceId");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_paidAt_idx" ON "SubscriptionInvoice"("paidAt");

-- CreateIndex
CREATE INDEX "SubscriptionInvoice_subscriptionId_paidAt_idx" ON "SubscriptionInvoice"("subscriptionId", "paidAt");

-- CreateIndex
CREATE INDEX "CreditTopUp_paidAt_idx" ON "CreditTopUp"("paidAt");

-- AddForeignKey
ALTER TABLE "CreditTopUpRefund" ADD CONSTRAINT "CreditTopUpRefund_creditTopUpId_fkey" FOREIGN KEY ("creditTopUpId") REFERENCES "CreditTopUp"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionInvoice" ADD CONSTRAINT "SubscriptionInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "Subscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Backfill: one refund row per purchase refunded before #2497, from its
-- cumulative columns, dated by the purchase's last update. The status before
-- the refund is inferred: a reversal means the credits were in the balance; no
-- credit date means the purchase was still held.
INSERT INTO "CreditTopUpRefund" (
    "id", "creditTopUpId", "cumulativeRefundedAmountCents", "amountCents",
    "withdrawnCreditsCents", "reversedCents", "statusBefore", "backfilled", "createdAt"
)
SELECT
    gen_random_uuid()::text,
    "id",
    "refundedAmountCents",
    "refundedAmountCents",
    "refundedCreditsCents",
    "reversedCents",
    CASE
        WHEN "status" = 'needs_review' THEN 'needs_review'
        WHEN "reversedCents" > 0 OR "creditedAt" IS NOT NULL THEN 'credited'
        ELSE 'held'
    END,
    true,
    "updatedAt"
FROM "CreditTopUp"
WHERE "refundedAmountCents" > 0;
