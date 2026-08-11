-- #1534: durable operator acknowledgement for known-foreign Shows escrow
-- campaigns. The full (chain, escrow, campaign id) identity prevents an
-- acknowledgement on a legacy escrow or another chain from suppressing a
-- different campaign that happens to reuse the same numeric id.
CREATE TABLE "ShowEscrowReconciliationAcknowledgement" (
    "id" TEXT NOT NULL,
    "chainId" INTEGER NOT NULL,
    "contractAddress" TEXT NOT NULL,
    "contractCampaignId" TEXT NOT NULL,
    "acknowledgedByUserId" TEXT NOT NULL,
    "note" TEXT,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedByUserId" TEXT,
    "revokedAt" TIMESTAMP(3),

    CONSTRAINT "ShowEscrowReconciliationAcknowledgement_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ShowEscrowReconciliationAcknowledgement_chainId_check"
      CHECK ("chainId" > 0),
    CONSTRAINT "ShowEscrowReconciliationAcknowledgement_contractAddress_check"
      CHECK ("contractAddress" ~ '^0x[0-9a-f]{40}$'),
    CONSTRAINT "ShowEscrowReconciliationAcknowledgement_contractCampaignId_check"
      CHECK ("contractCampaignId" ~ '^[1-9][0-9]*$'),
    CONSTRAINT "ShowEscrowReconciliationAcknowledgement_actor_check"
      CHECK (length("acknowledgedByUserId") > 0),
    CONSTRAINT "ShowEscrowReconciliationAcknowledgement_note_check"
      CHECK ("note" IS NULL OR length("note") <= 1000),
    CONSTRAINT "ShowEscrowReconciliationAcknowledgement_revocation_check"
      CHECK (
        ("revokedAt" IS NULL AND "revokedByUserId" IS NULL)
        OR
        ("revokedAt" IS NOT NULL AND length("revokedByUserId") > 0)
      )
);

CREATE UNIQUE INDEX "ShowEscrowReconciliationAcknowledgement_chainId_contractAdd_key"
ON "ShowEscrowReconciliationAcknowledgement"("chainId", "contractAddress", "contractCampaignId");

CREATE INDEX "ShowEscrowReconciliationAcknowledgement_contractCampaignId_idx"
ON "ShowEscrowReconciliationAcknowledgement"("contractCampaignId");

CREATE INDEX "ShowEscrowReconciliationAcknowledgement_acknowledgedAt_idx"
ON "ShowEscrowReconciliationAcknowledgement"("acknowledgedAt");
