-- Punchline complete-set unlock grants (#488): exactly-once reward grant per
-- collector per unlock, enforced at the database level.

-- CreateTable
CREATE TABLE "PunchlineUnlockGrant" (
    "id" TEXT NOT NULL,
    "unlockId" TEXT NOT NULL,
    "collectorUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PunchlineUnlockGrant_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PunchlineUnlockGrant_unlockId_collectorUserId_key" ON "PunchlineUnlockGrant"("unlockId", "collectorUserId");

-- CreateIndex
CREATE INDEX "PunchlineUnlockGrant_collectorUserId_idx" ON "PunchlineUnlockGrant"("collectorUserId");

-- AddForeignKey
ALTER TABLE "PunchlineUnlockGrant" ADD CONSTRAINT "PunchlineUnlockGrant_unlockId_fkey" FOREIGN KEY ("unlockId") REFERENCES "PunchlineUnlock"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PunchlineUnlockGrant" ADD CONSTRAINT "PunchlineUnlockGrant_collectorUserId_fkey" FOREIGN KEY ("collectorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
