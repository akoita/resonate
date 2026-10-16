-- #2166 admin users directory: activity timestamps and a durable admin audit trail.

-- AlterTable
ALTER TABLE "User"
    ADD COLUMN "lastSignInAt" TIMESTAMP(3),
    ADD COLUMN "lastActiveAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AdminAuditEvent" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetUserId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AdminAuditEvent_targetUserId_createdAt_idx" ON "AdminAuditEvent"("targetUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_actorUserId_createdAt_idx" ON "AdminAuditEvent"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "User_lastActiveAt_idx" ON "User"("lastActiveAt");

-- CreateIndex
CREATE INDEX "User_lastSignInAt_idx" ON "User"("lastSignInAt");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");
