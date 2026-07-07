-- #1334 Generation-credit meter (ADR-BM-3): USD-cent balance + append-only ledger.

-- CreateTable
CREATE TABLE "GenerationCreditAccount" (
    "userId" TEXT NOT NULL,
    "balanceCents" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GenerationCreditAccount_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "GenerationCreditTransaction" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "jobId" TEXT,
    "balanceAfterCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GenerationCreditTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GenerationCreditTransaction_userId_createdAt_idx" ON "GenerationCreditTransaction"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "GenerationCreditTransaction_jobId_idx" ON "GenerationCreditTransaction"("jobId");

-- AddForeignKey
ALTER TABLE "GenerationCreditAccount" ADD CONSTRAINT "GenerationCreditAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GenerationCreditTransaction" ADD CONSTRAINT "GenerationCreditTransaction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
