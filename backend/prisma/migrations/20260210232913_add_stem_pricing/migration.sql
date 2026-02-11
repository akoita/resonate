-- CreateTable
CREATE TABLE "StemPricing" (
    "id" TEXT NOT NULL,
    "stemId" TEXT NOT NULL,
    "basePlayPriceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.05,
    "remixSurchargeMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 1.5,
    "commercialMultiplier" DOUBLE PRECISION NOT NULL DEFAULT 3.0,
    "floorUsd" DOUBLE PRECISION NOT NULL DEFAULT 0.01,
    "ceilingUsd" DOUBLE PRECISION NOT NULL DEFAULT 50.0,
    "listingDurationDays" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StemPricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StemPricing_stemId_key" ON "StemPricing"("stemId");

-- AddForeignKey
ALTER TABLE "StemPricing" ADD CONSTRAINT "StemPricing_stemId_fkey" FOREIGN KEY ("stemId") REFERENCES "Stem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
