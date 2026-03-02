-- CreateTable
CREATE TABLE "KeyAuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "agentAddress" TEXT,
    "context" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeyAuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "KeyAuditLog_userId_idx" ON "KeyAuditLog"("userId");

-- CreateIndex
CREATE INDEX "KeyAuditLog_action_idx" ON "KeyAuditLog"("action");

-- CreateIndex
CREATE INDEX "KeyAuditLog_createdAt_idx" ON "KeyAuditLog"("createdAt");
