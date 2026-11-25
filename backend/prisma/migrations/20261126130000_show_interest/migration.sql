-- #2668: Shows "I would come" interest mode.
ALTER TABLE "ShowCampaign" ADD COLUMN "mode" VARCHAR(16) NOT NULL DEFAULT 'pledge';

CREATE TABLE "ShowInterest" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "city" VARCHAR(80),
    "notifyWhenOpen" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowInterest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShowInterest_campaignId_userId_key" ON "ShowInterest"("campaignId", "userId");
CREATE INDEX "ShowInterest_userId_idx" ON "ShowInterest"("userId");

ALTER TABLE "ShowInterest" ADD CONSTRAINT "ShowInterest_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ShowCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShowInterest" ADD CONSTRAINT "ShowInterest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
