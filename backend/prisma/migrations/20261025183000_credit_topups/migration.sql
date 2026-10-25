-- #1422 (Artist Pro slice 4): buying generation-credit packs through Stripe
-- Checkout, in test mode. Additive: one new table and one nullable ledger
-- column; no existing value changes. Bought credits carry no expiry.

-- AlterTable
ALTER TABLE "GenerationCreditTransaction" ADD COLUMN     "paymentRef" TEXT;

-- CreateTable
CREATE TABLE "CreditTopUp" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "packId" TEXT NOT NULL,
    "priceCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "creditsCents" INTEGER NOT NULL,
    "stripeCheckoutSessionId" TEXT NOT NULL,
    "stripePaymentIntentId" TEXT,
    "consentId" TEXT,
    "delivery" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "heldUntil" TIMESTAMP(3),
    "creditedAt" TIMESTAMP(3),
    "releaseBasis" TEXT,
    "creditedCents" INTEGER NOT NULL DEFAULT 0,
    "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "refundedCreditsCents" INTEGER NOT NULL DEFAULT 0,
    "reversedCents" INTEGER NOT NULL DEFAULT 0,
    "paidAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreditTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopUp_stripeCheckoutSessionId_key" ON "CreditTopUp"("stripeCheckoutSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CreditTopUp_stripePaymentIntentId_key" ON "CreditTopUp"("stripePaymentIntentId");

-- CreateIndex
CREATE INDEX "CreditTopUp_userId_status_heldUntil_idx" ON "CreditTopUp"("userId", "status", "heldUntil");

-- CreateIndex
CREATE INDEX "CreditTopUp_userId_createdAt_idx" ON "CreditTopUp"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationCreditTransaction_paymentRef_idx" ON "GenerationCreditTransaction"("paymentRef");

-- AddForeignKey
ALTER TABLE "CreditTopUp" ADD CONSTRAINT "CreditTopUp_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

