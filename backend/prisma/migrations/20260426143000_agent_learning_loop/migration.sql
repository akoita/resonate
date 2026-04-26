ALTER TABLE "AgentConfig" ADD COLUMN     "learnedTasteProfile" JSONB;
ALTER TABLE "AgentConfig" ADD COLUMN     "tasteScore" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "AgentConfig" ADD COLUMN     "tasteUpdatedAt" TIMESTAMP(3);

CREATE TABLE "AgentSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT,
    "trackId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentSignal_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AgentSignal_userId_createdAt_idx" ON "AgentSignal"("userId", "createdAt");
CREATE INDEX "AgentSignal_trackId_idx" ON "AgentSignal"("trackId");
CREATE INDEX "AgentSignal_sessionId_idx" ON "AgentSignal"("sessionId");
CREATE INDEX "AgentSignal_action_idx" ON "AgentSignal"("action");

ALTER TABLE "AgentSignal" ADD CONSTRAINT "AgentSignal_action_check" CHECK ("action" IN ('accept', 'skip', 'replay', 'add_to_playlist', 'purchase'));
ALTER TABLE "AgentSignal" ADD CONSTRAINT "AgentSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AgentSignal" ADD CONSTRAINT "AgentSignal_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AgentSignal" ADD CONSTRAINT "AgentSignal_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
