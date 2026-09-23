-- #1762: operator-reviewed recovery for accepted management transfers.
BEGIN;

CREATE TYPE "ManagementTransferRecoveryStatus" AS ENUM (
    'pending',
    'approved',
    'rejected'
);

CREATE TABLE "ManagementTransferRecoveryRequest" (
    "id" TEXT NOT NULL,
    "transferId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "evidence" TEXT,
    "resourceType" "ManagementResourceType" NOT NULL,
    "resourceIds" TEXT[] NOT NULL,
    "status" "ManagementTransferRecoveryStatus" NOT NULL DEFAULT 'pending',
    "reviewerUserId" TEXT,
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementTransferRecoveryRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManagementTransferRecoveryRequest_requesterUserId_createdAt_idx"
    ON "ManagementTransferRecoveryRequest"("requesterUserId", "createdAt");

CREATE INDEX "ManagementTransferRecoveryRequest_status_createdAt_idx"
    ON "ManagementTransferRecoveryRequest"("status", "createdAt");

CREATE INDEX "ManagementTransferRecoveryRequest_reviewerUserId_createdAt_idx"
    ON "ManagementTransferRecoveryRequest"("reviewerUserId", "createdAt");

CREATE INDEX "ManagementTransferRecoveryRequest_transferId_createdAt_idx"
    ON "ManagementTransferRecoveryRequest"("transferId", "createdAt");

CREATE UNIQUE INDEX "ManagementTransferRecoveryRequest_one_open_or_approved_idx"
    ON "ManagementTransferRecoveryRequest"("transferId")
    WHERE "status" IN ('pending', 'approved');

ALTER TABLE "ManagementTransferRecoveryRequest"
    ADD CONSTRAINT "ManagementTransferRecoveryRequest_transferId_fkey"
    FOREIGN KEY ("transferId") REFERENCES "ManagementTransfer"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManagementTransferRecoveryRequest"
    ADD CONSTRAINT "ManagementTransferRecoveryRequest_requesterUserId_fkey"
    FOREIGN KEY ("requesterUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManagementTransferRecoveryRequest"
    ADD CONSTRAINT "ManagementTransferRecoveryRequest_reviewerUserId_fkey"
    FOREIGN KEY ("reviewerUserId") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;

COMMIT;
