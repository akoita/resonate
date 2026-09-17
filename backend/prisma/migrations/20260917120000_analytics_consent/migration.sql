-- #1772: durable record of each person's explicit decision about optional
-- product analytics. Absence of a row means no decision, which the ingest gate
-- treats as refusal.
CREATE TABLE "AnalyticsConsent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "productAnalytics" BOOLEAN NOT NULL,
    "decidedAt" TIMESTAMP(3) NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnalyticsConsent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsConsent_userId_key" ON "AnalyticsConsent"("userId");

ALTER TABLE "AnalyticsConsent"
    ADD CONSTRAINT "AnalyticsConsent_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
