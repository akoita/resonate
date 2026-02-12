-- CreateTable
CREATE TABLE "AgentTransaction" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "listingId" BIGINT NOT NULL,
    "tokenId" BIGINT NOT NULL,
    "amount" BIGINT NOT NULL,
    "totalPriceWei" TEXT NOT NULL,
    "priceUsd" DOUBLE PRECISION NOT NULL,
    "txHash" TEXT,
    "userOpHash" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "AgentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgentTransaction_sessionId_idx" ON "AgentTransaction"("sessionId");

-- CreateIndex
CREATE INDEX "AgentTransaction_userId_idx" ON "AgentTransaction"("userId");

-- CreateIndex
CREATE INDEX "AgentTransaction_status_idx" ON "AgentTransaction"("status");

-- AddForeignKey
ALTER TABLE "AgentTransaction" ADD CONSTRAINT "AgentTransaction_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
