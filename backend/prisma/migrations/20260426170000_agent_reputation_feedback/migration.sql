-- CreateTable
CREATE TABLE "AgentReputationFeedback" (
    "id" TEXT NOT NULL,
    "subjectAgentConfigId" TEXT NOT NULL,
    "submitterUserId" TEXT,
    "submitterRole" TEXT NOT NULL,
    "submitterIdentifier" TEXT,
    "feedbackKind" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL,
    "evidenceUri" TEXT,
    "notes" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "replayHash" TEXT NOT NULL,
    "onchainStatus" TEXT NOT NULL DEFAULT 'Pending',
    "onchainTxHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentReputationFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AgentReputationFeedback_replayHash_key" ON "AgentReputationFeedback"("replayHash");

-- CreateIndex
CREATE INDEX "AgentReputationFeedback_subjectAgentConfigId_idx" ON "AgentReputationFeedback"("subjectAgentConfigId");

-- CreateIndex
CREATE INDEX "AgentReputationFeedback_submitterUserId_idx" ON "AgentReputationFeedback"("submitterUserId");

-- CreateIndex
CREATE INDEX "AgentReputationFeedback_createdAt_idx" ON "AgentReputationFeedback"("createdAt");

-- CreateIndex
CREATE INDEX "AgentReputationFeedback_submitterUserId_createdAt_idx" ON "AgentReputationFeedback"("submitterUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "AgentReputationFeedback" ADD CONSTRAINT "AgentReputationFeedback_subjectAgentConfigId_fkey" FOREIGN KEY ("subjectAgentConfigId") REFERENCES "AgentConfig"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentReputationFeedback" ADD CONSTRAINT "AgentReputationFeedback_submitterUserId_fkey" FOREIGN KEY ("submitterUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
