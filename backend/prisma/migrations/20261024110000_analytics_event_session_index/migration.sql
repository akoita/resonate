-- #2259: the operator view of one session's agent events reads AnalyticsEvent by session.
-- CreateIndex
CREATE INDEX "AnalyticsEvent_sessionId_occurredAt_idx" ON "AnalyticsEvent"("sessionId", "occurredAt");
