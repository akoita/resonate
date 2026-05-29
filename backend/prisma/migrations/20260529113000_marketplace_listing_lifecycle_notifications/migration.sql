ALTER TABLE "Notification"
ADD COLUMN "stemListingId" TEXT;

ALTER TABLE "NotificationPreference"
ADD COLUMN "listingExpiringSoon" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN "listingExpired" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX "Notification_walletAddress_type_stemListingId_idx"
ON "Notification"("walletAddress", "type", "stemListingId");
