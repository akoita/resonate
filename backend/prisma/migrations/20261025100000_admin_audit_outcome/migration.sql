-- #2173 admin hardening: the admin audit log records an outcome (a refused
-- step-up is `denied`) and is listed newest first, optionally by action.

-- AlterTable
ALTER TABLE "AdminAuditEvent" ADD COLUMN "outcome" TEXT NOT NULL DEFAULT 'success';

-- CreateIndex
CREATE INDEX "AdminAuditEvent_action_createdAt_idx" ON "AdminAuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AdminAuditEvent_createdAt_idx" ON "AdminAuditEvent"("createdAt");
