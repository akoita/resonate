-- #946: lock artist-approved critical campaign terms.
-- approvedTermsHash is a tamper-evident hash of the fan-risk terms captured
-- when artist authority is approved. While set, those terms are immutable
-- (edits are refused until authority is revoked) and activation re-verifies
-- the live terms still hash to this value. The full snapshot is stored in
-- ShowCampaign.metadata.approvedTerms.

-- AlterTable
ALTER TABLE "ShowCampaign" ADD COLUMN "approvedTermsHash" TEXT;
