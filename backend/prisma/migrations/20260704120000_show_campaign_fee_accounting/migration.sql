-- #1330 Stage B: ShowCampaignEscrow success-fee accounting.

ALTER TABLE "ShowEscrowIndexerState"
  ADD COLUMN "currentFeeBps" INTEGER,
  ADD COLUMN "feeRecipient" TEXT;

ALTER TABLE "ShowCampaign"
  ADD COLUMN "feeBps" INTEGER,
  ADD COLUMN "totalFeePaidUnits" TEXT NOT NULL DEFAULT '0';
