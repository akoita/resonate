CREATE TABLE "ShowCampaignVisual" (
  "id" TEXT NOT NULL,
  "campaignId" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'gallery',
  "publicUrl" TEXT NOT NULL,
  "storageUri" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "caption" TEXT,
  "credit" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "ShowCampaignVisual_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ShowCampaignVisual_campaignId_role_sortOrder_idx"
  ON "ShowCampaignVisual"("campaignId", "role", "sortOrder");

ALTER TABLE "ShowCampaignVisual"
  ADD CONSTRAINT "ShowCampaignVisual_campaignId_fkey"
  FOREIGN KEY ("campaignId") REFERENCES "ShowCampaign"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
