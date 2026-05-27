-- Extend Resonate Shows with trust, artist-authority, booking, and release
-- policy state. This migration is additive so existing campaign rows continue
-- to load while the production beta grows beyond placeholder campaigns.

CREATE TYPE "ShowCampaignLevel" AS ENUM (
    'signal',
    'provisional_campaign',
    'active_escrow_campaign'
);

CREATE TYPE "ShowArtistAuthorityStatus" AS ENUM (
    'none',
    'human_verified',
    'artist_acknowledged',
    'artist_authorized',
    'trusted_source_authorized',
    'rejected',
    'revoked',
    'expired'
);

CREATE TYPE "ShowCampaignBeneficiaryType" AS ENUM (
    'wallet',
    'split_contract',
    'multisig'
);

CREATE TYPE "ShowCampaignReleasePolicy" AS ENUM (
    'refund_only_until_booking',
    'staged_release',
    'manual_ops_release'
);

ALTER TYPE "ShowCampaignStatus" ADD VALUE IF NOT EXISTS 'fulfilled' AFTER 'booking_confirmed';
ALTER TYPE "ShowCampaignStatus" ADD VALUE IF NOT EXISTS 'deposit_released' AFTER 'booking_confirmed';
ALTER TYPE "ShowCampaignStatus" ADD VALUE IF NOT EXISTS 'refund_available' AFTER 'cancelled';

ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'campaign_signal_created' BEFORE 'campaign_created';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'campaign_escalated_to_escrow' AFTER 'campaign_activated';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'artist_authority_expired' AFTER 'campaign_activated';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'artist_authority_revoked' AFTER 'campaign_activated';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'artist_authority_rejected' AFTER 'campaign_activated';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'artist_authority_approved' AFTER 'campaign_activated';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'artist_authority_requested' AFTER 'campaign_activated';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'refund_available' AFTER 'booking_confirmed';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'fulfillment_confirmed' AFTER 'booking_confirmed';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'deposit_released' AFTER 'booking_confirmed';
ALTER TYPE "ShowCampaignEventType" ADD VALUE IF NOT EXISTS 'booking_evidence_submitted' AFTER 'booking_confirmed';

ALTER TABLE "ShowCampaign"
    ADD COLUMN "campaignLevel" "ShowCampaignLevel" NOT NULL DEFAULT 'signal',
    ADD COLUMN "artistAuthorityStatus" "ShowArtistAuthorityStatus" NOT NULL DEFAULT 'none',
    ADD COLUMN "authorityCredentialId" TEXT,
    ADD COLUMN "authorityEvidenceBundleId" TEXT,
    ADD COLUMN "beneficiaryAddress" TEXT,
    ADD COLUMN "beneficiaryType" "ShowCampaignBeneficiaryType",
    ADD COLUMN "bookingDeadline" TIMESTAMP(3),
    ADD COLUMN "releasePolicy" "ShowCampaignReleasePolicy" NOT NULL DEFAULT 'refund_only_until_booking',
    ADD COLUMN "depositReleaseBps" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "disputeWindowSeconds" INTEGER NOT NULL DEFAULT 604800,
    ADD COLUMN "artistAcceptedAt" TIMESTAMP(3),
    ADD COLUMN "bookingEvidenceBundleId" TEXT,
    ADD COLUMN "fulfillmentEvidenceBundleId" TEXT,
    ADD COLUMN "depositReleasedAt" TIMESTAMP(3),
    ADD COLUMN "fulfilledAt" TIMESTAMP(3),
    ADD COLUMN "refundAvailableAt" TIMESTAMP(3);

CREATE INDEX "ShowCampaign_campaignLevel_status_idx" ON "ShowCampaign"("campaignLevel", "status");
CREATE INDEX "ShowCampaign_artistAuthorityStatus_idx" ON "ShowCampaign"("artistAuthorityStatus");
CREATE INDEX "ShowCampaign_beneficiaryAddress_idx" ON "ShowCampaign"("beneficiaryAddress");
CREATE INDEX "ShowCampaign_bookingDeadline_idx" ON "ShowCampaign"("bookingDeadline");
