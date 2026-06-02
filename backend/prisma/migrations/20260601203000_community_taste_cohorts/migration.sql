CREATE TABLE "CommunityCohort" (
    "id" TEXT NOT NULL,
    "cohortType" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "safeExplanation" TEXT NOT NULL,
    "minimumSize" INTEGER NOT NULL DEFAULT 5,
    "visibleMemberCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "metadata" JSONB,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityCohort_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityCohortMembership" (
    "id" TEXT NOT NULL,
    "cohortId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'suggested',
    "suggestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "suggestedEventAt" TIMESTAMP(3),
    "joinedAt" TIMESTAMP(3),
    "leftAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityCohortMembership_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CommunityCohort_cohortType_status_expiresAt_idx" ON "CommunityCohort"("cohortType", "status", "expiresAt");
CREATE INDEX "CommunityCohort_reasonCode_status_idx" ON "CommunityCohort"("reasonCode", "status");
CREATE INDEX "CommunityCohort_status_visibleMemberCount_idx" ON "CommunityCohort"("status", "visibleMemberCount");

CREATE UNIQUE INDEX "CommunityCohortMembership_identity" ON "CommunityCohortMembership"("cohortId", "userId");
CREATE INDEX "CommunityCohortMembership_userId_status_updatedAt_idx" ON "CommunityCohortMembership"("userId", "status", "updatedAt");
CREATE INDEX "CommunityCohortMembership_cohortId_status_idx" ON "CommunityCohortMembership"("cohortId", "status");

ALTER TABLE "CommunityCohortMembership"
  ADD CONSTRAINT "CommunityCohortMembership_cohortId_fkey"
  FOREIGN KEY ("cohortId") REFERENCES "CommunityCohort"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityCohortMembership"
  ADD CONSTRAINT "CommunityCohortMembership_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
