-- CreateTable
CREATE TABLE "SessionKey" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "serializedKey" TEXT NOT NULL,
    "permissions" JSONB NOT NULL,
    "validUntil" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "txHash" TEXT,
    "revokeTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SessionKey_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SessionKey_userId_idx" ON "SessionKey"("userId");

-- AddForeignKey
ALTER TABLE "SessionKey" ADD CONSTRAINT "SessionKey_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
