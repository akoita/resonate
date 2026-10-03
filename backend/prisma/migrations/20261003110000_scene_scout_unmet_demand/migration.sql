-- #1969: short-lived requester-linked categorical observations and
-- aggregate-only Scene Scout snapshots. No prompt, session id, or requester
-- identity is copied into DemandSignal.

CREATE TABLE "DemandObservation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sourceType" VARCHAR(16) NOT NULL,
    "sourceKey" CHAR(64) NOT NULL,
    "targetArtistId" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "targetType" VARCHAR(16) NOT NULL,
    "evidenceTrackId" TEXT,
    "kind" VARCHAR(24) NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "consentDecidedAt" TIMESTAMP(3) NOT NULL,
    "tastePolicyUpdatedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandObservation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemandObservation_sourceType_check" CHECK ("sourceType" IN ('crate', 'session')),
    CONSTRAINT "DemandObservation_targetType_check" CHECK ("targetType" IN ('artist', 'genre', 'track')),
    CONSTRAINT "DemandObservation_kind_check" CHECK ("kind" IN ('stem', 'license', 'bpm', 'key', 'energy', 'mood', 'genre', 'price', 'verifiedHuman')),
    CONSTRAINT "DemandObservation_expiry_check" CHECK ("expiresAt" > "observedAt"),
    CONSTRAINT "DemandObservation_userId_fkey"
        FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DemandObservation_source_target_category_key"
    ON "DemandObservation"("userId", "sourceKey", "targetType", "targetId", "kind", "value");
CREATE INDEX "DemandObservation_targetArtistId_expiresAt_observedAt_idx"
    ON "DemandObservation"("targetArtistId", "expiresAt", "observedAt");
CREATE INDEX "DemandObservation_userId_expiresAt_idx"
    ON "DemandObservation"("userId", "expiresAt");
CREATE INDEX "DemandObservation_expiresAt_idx"
    ON "DemandObservation"("expiresAt");

CREATE TABLE "DemandSignal" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "targetType" VARCHAR(16) NOT NULL,
    "targetId" TEXT NOT NULL,
    "kind" VARCHAR(24) NOT NULL,
    "value" VARCHAR(64) NOT NULL,
    "windowDays" INTEGER NOT NULL,
    "distinctRequesters" INTEGER NOT NULL,
    "requestCount" INTEGER NOT NULL,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemandSignal_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DemandSignal_targetType_check" CHECK ("targetType" IN ('artist', 'genre', 'track')),
    CONSTRAINT "DemandSignal_kind_check" CHECK ("kind" IN ('stem', 'license', 'bpm', 'key', 'energy', 'mood', 'genre', 'price', 'verifiedHuman')),
    CONSTRAINT "DemandSignal_windowDays_check" CHECK ("windowDays" IN (7, 28)),
    CONSTRAINT "DemandSignal_counts_check" CHECK ("distinctRequesters" >= 0 AND "requestCount" >= 0),
    CONSTRAINT "DemandSignal_artistId_fkey"
        FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "DemandSignal_artist_target_category_window_key"
    ON "DemandSignal"("artistId", "targetType", "targetId", "kind", "value", "windowDays");
CREATE INDEX "DemandSignal_artistId_computedAt_idx"
    ON "DemandSignal"("artistId", "computedAt");
