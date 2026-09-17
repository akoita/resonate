-- #1793: an artist can withdraw a release from streaming and restore it later.
-- Withdrawal suspends the streaming licence only: the row stays, so purchases,
-- library entries and playlist references keep resolving. `Release.status` gains
-- a new value ("withdrawn"); `statusBeforeWithdrawal` records where to restore to.
ALTER TABLE "Release"
  ADD COLUMN "withdrawnAt" TIMESTAMP(3),
  ADD COLUMN "withdrawalReason" TEXT,
  ADD COLUMN "statusBeforeWithdrawal" TEXT;
