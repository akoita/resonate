-- #2594: the in-app withdrawal function.
ALTER TYPE "SubscriptionEndReason" ADD VALUE 'contract_withdrawal';

CREATE TABLE "ContractWithdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contract" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "contractLabel" VARCHAR(200) NOT NULL,
    "statementName" VARCHAR(120) NOT NULL,
    "labelsVersion" VARCHAR(64) NOT NULL,
    "withdrawnAt" TIMESTAMP(3) NOT NULL,
    "currency" TEXT NOT NULL,
    "paidCents" INTEGER NOT NULL,
    "refundCents" INTEGER NOT NULL,
    "refundStatus" TEXT NOT NULL,
    "stripeRefundId" TEXT,
    "refundAttempts" INTEGER NOT NULL DEFAULT 0,
    "refundLastError" VARCHAR(64),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContractWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ContractWithdrawal_contract_subjectId_key" ON "ContractWithdrawal"("contract", "subjectId");
CREATE INDEX "ContractWithdrawal_userId_withdrawnAt_idx" ON "ContractWithdrawal"("userId", "withdrawnAt");
CREATE INDEX "ContractWithdrawal_refundStatus_idx" ON "ContractWithdrawal"("refundStatus");

ALTER TABLE "ContractWithdrawal" ADD CONSTRAINT "ContractWithdrawal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
