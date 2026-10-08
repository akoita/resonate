-- #2119: durable work items for propagating analytics-consent withdrawal.
CREATE TABLE "AnalyticsConsentWithdrawal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "consentBasis" TEXT NOT NULL DEFAULT 'consent',
    "withdrawnAt" TIMESTAMP(3) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "lastErrorStatus" TEXT,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "deleted" INTEGER NOT NULL DEFAULT 0,
    "redacted" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsConsentWithdrawal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsConsentWithdrawal_status_withdrawnAt_idx"
    ON "AnalyticsConsentWithdrawal"("status", "withdrawnAt");
CREATE INDEX "AnalyticsConsentWithdrawal_userId_idx"
    ON "AnalyticsConsentWithdrawal"("userId");

ALTER TABLE "AnalyticsConsentWithdrawal"
    ADD CONSTRAINT "AnalyticsConsentWithdrawal_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: withdrawals recorded before this change only stopped future
-- collection; the events captured under the earlier grant were never removed.
-- Enqueue one pending withdrawal per current refusal, bounded by that
-- decision's time. The scheduled job only touches consent-based events received
-- up to the bound, so a person who never granted has nothing to remove and the
-- row completes without a warehouse call. gen_random_uuid() is core since PG 13.
INSERT INTO "AnalyticsConsentWithdrawal" ("id", "userId", "consentBasis", "withdrawnAt", "status", "updatedAt")
SELECT gen_random_uuid()::text, "userId", 'consent', "decidedAt", 'pending', CURRENT_TIMESTAMP
FROM "AnalyticsConsent"
WHERE "productAnalytics" = false;
