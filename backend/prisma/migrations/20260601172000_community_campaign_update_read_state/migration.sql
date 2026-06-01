-- Track the latest campaign update a room member has already seen so view
-- analytics do not count every message-list refresh as a fresh view.
ALTER TABLE "CommunityMembership"
  ADD COLUMN "lastViewedCampaignUpdateId" TEXT,
  ADD COLUMN "lastViewedCampaignUpdateAt" TIMESTAMP(3);

