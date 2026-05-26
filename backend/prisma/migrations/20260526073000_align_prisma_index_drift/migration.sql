-- Align committed migrations with the current Prisma schema indexes.
DROP INDEX IF EXISTS "ContentProtectionStake_paymentToken_idx";
DROP INDEX IF EXISTS "Dispute_counterStakeToken_idx";
DROP INDEX IF EXISTS "RoyaltyPayment_paymentToken_idx";
DROP INDEX IF EXISTS "StemPurchase_paymentToken_idx";

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'RightsRouteReassessment_evidenceSubjectType_evidenceSubjectId_i'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_class WHERE relname = 'RightsRouteReassessment_evidenceSubjectType_evidenceSubject_idx'
  ) THEN
    ALTER INDEX "RightsRouteReassessment_evidenceSubjectType_evidenceSubjectId_i"
      RENAME TO "RightsRouteReassessment_evidenceSubjectType_evidenceSubject_idx";
  END IF;
END $$;
