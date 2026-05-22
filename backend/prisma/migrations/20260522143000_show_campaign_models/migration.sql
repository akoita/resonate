-- Resonate Shows campaign data model.
-- Stores campaign, tier, pledge receipt, and lifecycle event state for the
-- fan-funded live campaign beta without hardcoding chain or asset choices.

CREATE TYPE "ShowCampaignStatus" AS ENUM (
    'draft',
    'active',
    'funded',
    'booking_confirmed',
    'released',
    'cancelled',
    'refunded'
);

CREATE TYPE "ShowPledgeStatus" AS ENUM (
    'intent_created',
    'submitted',
    'confirmed',
    'refund_available',
    'refunded',
    'released',
    'failed'
);

CREATE TYPE "ShowPledgeConfirmationStatus" AS ENUM (
    'not_submitted',
    'pending',
    'confirmed',
    'failed'
);

CREATE TYPE "ShowCampaignEventType" AS ENUM (
    'campaign_created',
    'campaign_updated',
    'campaign_activated',
    'campaign_funded',
    'booking_confirmed',
    'campaign_released',
    'campaign_cancelled',
    'campaign_refunded',
    'pledge_intent_created',
    'pledge_submitted',
    'pledge_confirmed',
    'pledge_refund_available',
    'pledge_refunded',
    'pledge_released',
    'pledge_failed',
    'operator_note'
);

CREATE TABLE "ShowCampaign" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "artistId" TEXT,
    "artistDisplayName" TEXT NOT NULL,
    "artistImageUrl" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "city" TEXT NOT NULL,
    "country" TEXT NOT NULL,
    "venueTarget" TEXT,
    "targetDate" TIMESTAMP(3),
    "deadline" TIMESTAMP(3) NOT NULL,
    "goalAmountUnits" TEXT NOT NULL,
    "minimumBackers" INTEGER,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentAssetId" TEXT,
    "paymentAssetSymbol" TEXT NOT NULL DEFAULT 'USDC',
    "paymentAssetDecimals" INTEGER NOT NULL DEFAULT 6,
    "paymentTokenAddress" TEXT,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT,
    "contractCampaignId" TEXT,
    "status" "ShowCampaignStatus" NOT NULL DEFAULT 'draft',
    "raisedAmountUnits" TEXT NOT NULL DEFAULT '0',
    "confirmedPledgeCount" INTEGER NOT NULL DEFAULT 0,
    "uniqueBackerCount" INTEGER NOT NULL DEFAULT 0,
    "bookingTerms" JSONB,
    "fulfillmentNotes" TEXT,
    "metadata" JSONB,
    "activatedAt" TIMESTAMP(3),
    "fundedAt" TIMESTAMP(3),
    "bookingConfirmedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowCampaign_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShowCampaignTier" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "amountUnits" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentAssetId" TEXT,
    "paymentAssetSymbol" TEXT NOT NULL DEFAULT 'USDC',
    "paymentAssetDecimals" INTEGER NOT NULL DEFAULT 6,
    "maxBackers" INTEGER,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "benefits" JSONB,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowCampaignTier_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShowPledge" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "tierId" TEXT,
    "userId" TEXT,
    "walletAddress" TEXT NOT NULL,
    "amountUnits" TEXT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "paymentAssetId" TEXT,
    "paymentAssetSymbol" TEXT NOT NULL DEFAULT 'USDC',
    "paymentAssetDecimals" INTEGER NOT NULL DEFAULT 6,
    "paymentTokenAddress" TEXT,
    "chainId" INTEGER NOT NULL,
    "transactionHash" TEXT,
    "blockNumber" BIGINT,
    "confirmationStatus" "ShowPledgeConfirmationStatus" NOT NULL DEFAULT 'not_submitted',
    "status" "ShowPledgeStatus" NOT NULL DEFAULT 'intent_created',
    "receiptId" TEXT,
    "receipt" JSONB,
    "failureReason" TEXT,
    "submittedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "refundAvailableAt" TIMESTAMP(3),
    "refundedAt" TIMESTAMP(3),
    "releasedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ShowPledge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ShowCampaignEvent" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "pledgeId" TEXT,
    "eventType" "ShowCampaignEventType" NOT NULL,
    "actorUserId" TEXT,
    "actorWalletAddress" TEXT,
    "previousStatus" TEXT,
    "nextStatus" TEXT,
    "transactionHash" TEXT,
    "blockNumber" BIGINT,
    "metadata" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShowCampaignEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ShowCampaign_slug_key" ON "ShowCampaign"("slug");
CREATE INDEX "ShowCampaign_artistId_idx" ON "ShowCampaign"("artistId");
CREATE INDEX "ShowCampaign_status_deadline_idx" ON "ShowCampaign"("status", "deadline");
CREATE INDEX "ShowCampaign_city_country_idx" ON "ShowCampaign"("city", "country");
CREATE INDEX "ShowCampaign_chainId_contractAddress_idx" ON "ShowCampaign"("chainId", "contractAddress");
CREATE INDEX "ShowCampaign_contractCampaignId_idx" ON "ShowCampaign"("contractCampaignId");

CREATE INDEX "ShowCampaignTier_campaignId_sortOrder_idx" ON "ShowCampaignTier"("campaignId", "sortOrder");
CREATE INDEX "ShowCampaignTier_isActive_idx" ON "ShowCampaignTier"("isActive");

CREATE UNIQUE INDEX "ShowPledge_receiptId_key" ON "ShowPledge"("receiptId");
CREATE UNIQUE INDEX "ShowPledge_transactionHash_chainId_key" ON "ShowPledge"("transactionHash", "chainId");
CREATE INDEX "ShowPledge_campaignId_status_idx" ON "ShowPledge"("campaignId", "status");
CREATE INDEX "ShowPledge_tierId_idx" ON "ShowPledge"("tierId");
CREATE INDEX "ShowPledge_userId_createdAt_idx" ON "ShowPledge"("userId", "createdAt");
CREATE INDEX "ShowPledge_walletAddress_chainId_idx" ON "ShowPledge"("walletAddress", "chainId");
CREATE INDEX "ShowPledge_confirmationStatus_idx" ON "ShowPledge"("confirmationStatus");

CREATE INDEX "ShowCampaignEvent_campaignId_occurredAt_idx" ON "ShowCampaignEvent"("campaignId", "occurredAt");
CREATE INDEX "ShowCampaignEvent_pledgeId_idx" ON "ShowCampaignEvent"("pledgeId");
CREATE INDEX "ShowCampaignEvent_eventType_occurredAt_idx" ON "ShowCampaignEvent"("eventType", "occurredAt");
CREATE INDEX "ShowCampaignEvent_actorUserId_idx" ON "ShowCampaignEvent"("actorUserId");
CREATE INDEX "ShowCampaignEvent_transactionHash_idx" ON "ShowCampaignEvent"("transactionHash");

ALTER TABLE "ShowCampaign" ADD CONSTRAINT "ShowCampaign_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShowCampaignTier" ADD CONSTRAINT "ShowCampaignTier_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ShowCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShowPledge" ADD CONSTRAINT "ShowPledge_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ShowCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShowPledge" ADD CONSTRAINT "ShowPledge_tierId_fkey" FOREIGN KEY ("tierId") REFERENCES "ShowCampaignTier"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShowPledge" ADD CONSTRAINT "ShowPledge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShowCampaignEvent" ADD CONSTRAINT "ShowCampaignEvent_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "ShowCampaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ShowCampaignEvent" ADD CONSTRAINT "ShowCampaignEvent_pledgeId_fkey" FOREIGN KEY ("pledgeId") REFERENCES "ShowPledge"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ShowCampaignEvent" ADD CONSTRAINT "ShowCampaignEvent_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
