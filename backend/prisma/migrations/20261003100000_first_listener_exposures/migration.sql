-- Durable placements for the first-listener exploration slot (#1970).
-- Placement rows are bounded at serving time and are joined to actual,
-- consent-qualified playback events only when reception is summarized.
CREATE TABLE "FirstListenerExposure" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FirstListenerExposure_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "FirstListenerExposure_userId_releaseId_key"
    ON "FirstListenerExposure"("userId", "releaseId");
CREATE INDEX "FirstListenerExposure_releaseId_placedAt_idx"
    ON "FirstListenerExposure"("releaseId", "placedAt");
CREATE INDEX "FirstListenerExposure_userId_placedAt_idx"
    ON "FirstListenerExposure"("userId", "placedAt");

ALTER TABLE "FirstListenerExposure"
    ADD CONSTRAINT "FirstListenerExposure_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "FirstListenerExposure"
    ADD CONSTRAINT "FirstListenerExposure_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Account erasure cascades listener identity rows. Keep a monotonic release
-- budget so deletion cannot restore first-listener placements.
ALTER TABLE "Release"
    ADD COLUMN "firstListenerPlacementsUsed" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "AnalyticsEvent_actorId_eventName_occurredAt_idx"
    ON "AnalyticsEvent"("actorId", "eventName", "occurredAt");
