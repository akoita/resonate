-- CreateTable
CREATE TABLE "CreatorTrust" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "tier" TEXT NOT NULL DEFAULT 'new',
    "totalUploads" INTEGER NOT NULL DEFAULT 0,
    "cleanHistory" INTEGER NOT NULL DEFAULT 0,
    "disputesLost" INTEGER NOT NULL DEFAULT 0,
    "accountAgeDays" INTEGER NOT NULL DEFAULT 0,
    "stakeAmountWei" TEXT NOT NULL DEFAULT '10000000000000000',
    "escrowDays" INTEGER NOT NULL DEFAULT 30,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CreatorTrust_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CreatorTrust_artistId_key" ON "CreatorTrust"("artistId");

-- AddForeignKey
ALTER TABLE "CreatorTrust" ADD CONSTRAINT "CreatorTrust_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
