-- Continuous rights route reassessment and audit sampling history.

CREATE TABLE "RightsRouteReassessment" (
  "id" TEXT NOT NULL,
  "releaseId" TEXT NOT NULL,
  "trigger" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending_review',
  "previousRoute" TEXT,
  "recommendedRoute" TEXT,
  "nextRoute" TEXT,
  "reason" TEXT NOT NULL,
  "actorAddress" TEXT,
  "evidenceSubjectType" TEXT,
  "evidenceSubjectId" TEXT,
  "trustedSourceLinkId" TEXT,
  "rightsUpgradeRequestId" TEXT,
  "policyVersion" TEXT,
  "flags" JSONB,
  "reviewedBy" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RightsRouteReassessment_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RightsRouteReassessment_releaseId_createdAt_idx"
  ON "RightsRouteReassessment"("releaseId", "createdAt");

CREATE INDEX "RightsRouteReassessment_status_createdAt_idx"
  ON "RightsRouteReassessment"("status", "createdAt");

CREATE INDEX "RightsRouteReassessment_trigger_createdAt_idx"
  ON "RightsRouteReassessment"("trigger", "createdAt");

CREATE INDEX "RightsRouteReassessment_trustedSourceLinkId_idx"
  ON "RightsRouteReassessment"("trustedSourceLinkId");

CREATE INDEX "RightsRouteReassessment_evidenceSubjectType_evidenceSubjectId_idx"
  ON "RightsRouteReassessment"("evidenceSubjectType", "evidenceSubjectId");

ALTER TABLE "RightsRouteReassessment"
  ADD CONSTRAINT "RightsRouteReassessment_releaseId_fkey"
  FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
