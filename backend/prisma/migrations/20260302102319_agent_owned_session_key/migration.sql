-- Agent-Owned Session Key: Move private key generation to backend
-- Breaking change: existing session keys are invalidated
-- 1. Clear all existing session keys (they used the old serializedKey format)
DELETE FROM "SessionKey";
-- 2. Drop old column
ALTER TABLE "SessionKey" DROP COLUMN "serializedKey";
-- 3. Add new columns
ALTER TABLE "SessionKey"
ADD COLUMN "agentPrivateKey" TEXT NOT NULL;
ALTER TABLE "SessionKey"
ADD COLUMN "agentAddress" TEXT NOT NULL;
ALTER TABLE "SessionKey"
ADD COLUMN "approvalData" TEXT;