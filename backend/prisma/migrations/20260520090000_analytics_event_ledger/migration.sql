CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventName" TEXT NOT NULL,
    "eventVersion" INTEGER NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL,
    "producer" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "privacyTier" TEXT NOT NULL,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "actorId" TEXT,
    "sessionId" TEXT,
    "traceId" TEXT,
    "schemaUri" TEXT,
    "consentBasis" TEXT,
    "payload" JSONB NOT NULL,
    "sourceRefs" JSONB,
    "envelope" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AnalyticsEvent_eventId_key" ON "AnalyticsEvent"("eventId");
CREATE INDEX "AnalyticsEvent_eventName_occurredAt_idx" ON "AnalyticsEvent"("eventName", "occurredAt");
CREATE INDEX "AnalyticsEvent_producer_occurredAt_idx" ON "AnalyticsEvent"("producer", "occurredAt");
CREATE INDEX "AnalyticsEvent_privacyTier_occurredAt_idx" ON "AnalyticsEvent"("privacyTier", "occurredAt");
CREATE INDEX "AnalyticsEvent_subjectType_subjectId_idx" ON "AnalyticsEvent"("subjectType", "subjectId");
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

CREATE TABLE "AnalyticsGovernanceLog" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "eventId" TEXT,
    "eventName" TEXT,
    "subjectType" TEXT,
    "subjectId" TEXT,
    "actorId" TEXT,
    "privacyTier" TEXT,
    "reason" TEXT NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsGovernanceLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AnalyticsGovernanceLog_action_createdAt_idx" ON "AnalyticsGovernanceLog"("action", "createdAt");
CREATE INDEX "AnalyticsGovernanceLog_eventId_idx" ON "AnalyticsGovernanceLog"("eventId");
CREATE INDEX "AnalyticsGovernanceLog_actorId_idx" ON "AnalyticsGovernanceLog"("actorId");
CREATE INDEX "AnalyticsGovernanceLog_subjectType_subjectId_idx" ON "AnalyticsGovernanceLog"("subjectType", "subjectId");
