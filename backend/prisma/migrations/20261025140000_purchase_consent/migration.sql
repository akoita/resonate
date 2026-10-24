-- #1776 immediate-delivery consent for consumer digital purchases. A buyer, before
-- paying, either asks for immediate delivery and acknowledges that this ends the
-- withdrawal right, or chooses to wait out the withdrawal period. Delivery
-- (download, licence, collectible grant) is released only against a matching
-- consent or an elapsed hold; an on-chain mint requires a consent. Append-only.

-- CreateTable
CREATE TABLE "PurchaseConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "surface" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "subjectLabel" TEXT NOT NULL,
    "licenseType" TEXT,
    "deliveryKind" TEXT NOT NULL,
    "consented" BOOLEAN NOT NULL,
    "acknowledgedWaiver" BOOLEAN NOT NULL,
    "textVersion" TEXT NOT NULL,
    "transactionHash" TEXT,
    "purchaseRef" TEXT,
    "linkedAt" TIMESTAMP(3),
    "deliveryAvailableAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PurchaseConsent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PurchaseConsent_userId_surface_subjectId_createdAt_idx" ON "PurchaseConsent"("userId", "surface", "subjectId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseConsent_transactionHash_idx" ON "PurchaseConsent"("transactionHash");

-- CreateIndex
CREATE INDEX "PurchaseConsent_purchaseRef_idx" ON "PurchaseConsent"("purchaseRef");

-- AddForeignKey
ALTER TABLE "PurchaseConsent" ADD CONSTRAINT "PurchaseConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
