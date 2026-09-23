BEGIN;

CREATE TYPE "ArtistClaimDecision" AS ENUM ('approve', 'reject', 'revoke');

CREATE TABLE "ArtistClaimDecisionEvent" (
  "id" TEXT NOT NULL,
  "claimId" TEXT NOT NULL,
  "actorUserId" TEXT,
  "decision" "ArtistClaimDecision" NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "ArtistClaimDecisionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ArtistClaimDecisionEvent_claimId_createdAt_idx"
  ON "ArtistClaimDecisionEvent"("claimId", "createdAt");
CREATE INDEX "ArtistClaimDecisionEvent_actorUserId_idx"
  ON "ArtistClaimDecisionEvent"("actorUserId");

ALTER TABLE "ArtistClaimDecisionEvent"
  ADD CONSTRAINT "ArtistClaimDecisionEvent_claimId_fkey"
  FOREIGN KEY ("claimId") REFERENCES "ArtistClaimRequest"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ArtistClaimDecisionEvent"
  ADD CONSTRAINT "ArtistClaimDecisionEvent_actorUserId_fkey"
  FOREIGN KEY ("actorUserId") REFERENCES "User"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
