-- #1771 slice 3: account closure and erasure.
--
-- Erasure anonymizes in place and closes the account; it does not delete the
-- "User" row. For wallet and passkey accounts "User"."id" *is* the person's
-- lowercased wallet address, so the erasure engine rotates it to a fresh UUID.
-- Every foreign key in this database is ON UPDATE CASCADE (103 of 103), so the
-- rotation propagates to every relation-linked table; the columns that hold a
-- user id without a declared relation are listed in
-- src/modules/privacy/personal_data_erasure_manifest.ts and rewritten by hand.
--
-- This migration only adds the declaration and the request state machine. It
-- performs no erasure and rewrites no existing row.

-- CreateEnum
CREATE TYPE "AccountClosureStatus" AS ENUM ('pending', 'cancelled', 'completed', 'failed');

-- AlterTable: mark a closed and erased account.
ALTER TABLE "User"
    ADD COLUMN "closedAt" TIMESTAMP(3),
    ADD COLUMN "erasedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "AccountClosureRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "AccountClosureStatus" NOT NULL DEFAULT 'pending',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "reason" TEXT,
    "failureMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AccountClosureRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AccountClosureRequest_status_dueAt_idx" ON "AccountClosureRequest"("status", "dueAt");
CREATE INDEX "AccountClosureRequest_userId_requestedAt_idx" ON "AccountClosureRequest"("userId", "requestedAt");

-- One *active* request per person. A partial unique index rather than an
-- application check: a double-submitted request racing itself would otherwise
-- schedule the erasure engine twice against the same account, and the second
-- run would find a person who no longer exists. Cancelled, completed and failed
-- rows are history and may accumulate.
CREATE UNIQUE INDEX "AccountClosureRequest_one_pending_per_user"
    ON "AccountClosureRequest"("userId")
    WHERE "status" = 'pending';

ALTER TABLE "AccountClosureRequest"
    ADD CONSTRAINT "AccountClosureRequest_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
