-- #2595: refunds owed on an operator closure that is not for a serious breach.
CREATE TABLE "ClosureRefund" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
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

    CONSTRAINT "ClosureRefund_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClosureRefund_kind_subjectId_key" ON "ClosureRefund"("kind", "subjectId");
CREATE INDEX "ClosureRefund_userId_closedAt_idx" ON "ClosureRefund"("userId", "closedAt");
CREATE INDEX "ClosureRefund_refundStatus_idx" ON "ClosureRefund"("refundStatus");

ALTER TABLE "ClosureRefund" ADD CONSTRAINT "ClosureRefund_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
