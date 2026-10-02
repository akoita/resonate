-- #1967 (Crate Digger watching, notify only): a crate can watch for newly
-- playable tracks that fit its filters. "Crate"."watchMode" is "off" or
-- "notify" ("auto_buy" is reserved and rejected by the API until it is built).
-- "CrateWatchMatch"."trackId" has no foreign key on purpose, so a removed track
-- does not rewrite what was matched. "Notification"."crateId" is the crate a
-- crate_watch_match notification leads to. Generated with `prisma migrate diff`
-- against the previous schema; no unrelated drift.

-- AlterTable
ALTER TABLE "Crate" ADD COLUMN     "watchExpiresAt" TIMESTAMP(3),
ADD COLUMN     "watchMode" TEXT NOT NULL DEFAULT 'off';

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "crateId" TEXT;

-- CreateTable
CREATE TABLE "CrateWatchMatch" (
    "id" TEXT NOT NULL,
    "crateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "matchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "notifiedAt" TIMESTAMP(3),

    CONSTRAINT "CrateWatchMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CrateWatchMatch_userId_matchedAt_idx" ON "CrateWatchMatch"("userId", "matchedAt");

-- CreateIndex
CREATE UNIQUE INDEX "CrateWatchMatch_crateId_trackId_key" ON "CrateWatchMatch"("crateId", "trackId");

-- CreateIndex
CREATE INDEX "Crate_watchMode_watchExpiresAt_idx" ON "Crate"("watchMode", "watchExpiresAt");

-- AddForeignKey
ALTER TABLE "CrateWatchMatch" ADD CONSTRAINT "CrateWatchMatch_crateId_fkey" FOREIGN KEY ("crateId") REFERENCES "Crate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrateWatchMatch" ADD CONSTRAINT "CrateWatchMatch_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
