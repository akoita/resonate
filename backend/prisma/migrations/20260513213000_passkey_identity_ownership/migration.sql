CREATE TABLE "PasskeyIdentity" (
    "id" TEXT NOT NULL,
    "publicKeyHash" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstWalletAddress" TEXT,
    "lastWalletAddress" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PasskeyIdentity_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasskeyIdentity_publicKeyHash_key" ON "PasskeyIdentity"("publicKeyHash");
CREATE INDEX "PasskeyIdentity_userId_idx" ON "PasskeyIdentity"("userId");
CREATE INDEX "PasskeyIdentity_lastWalletAddress_idx" ON "PasskeyIdentity"("lastWalletAddress");

ALTER TABLE "PasskeyIdentity"
ADD CONSTRAINT "PasskeyIdentity_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "User"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
