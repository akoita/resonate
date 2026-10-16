-- #2169 email notices: an optional, double opt-in contact address; an outbox of
-- one email per (notice, recipient) drained by a scheduled job; and a fan-out
-- marker on notices.

-- AlterTable
ALTER TABLE "Notice" ADD COLUMN "emailFannedOutAt" TIMESTAMP(3);

-- AlterTable: per-account limit on confirmation emails (survives removing the address)
ALTER TABLE "User" ADD COLUMN "confirmationSendCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "confirmationWindowStartedAt" TIMESTAMP(3),
ADD COLUMN "lastConfirmationSentAt" TIMESTAMP(3);

-- Notices that exist today predate email delivery and must never be emailed.
UPDATE "Notice" SET "emailFannedOutAt" = NOW();

-- CreateTable
CREATE TABLE "ContactEmail" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "addressNormalized" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "confirmTokenHash" TEXT,
    "confirmTokenExpiresAt" TIMESTAMP(3),
    "confirmationSentAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "disabledAt" TIMESTAMP(3),
    "disabledReason" TEXT,
    "emailOptOuts" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactEmail_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastErrorClass" TEXT,
    "providerMessageId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ContactEmail_userId_key" ON "ContactEmail"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ContactEmail_confirmTokenHash_key" ON "ContactEmail"("confirmTokenHash");

-- CreateIndex
CREATE INDEX "ContactEmail_addressNormalized_idx" ON "ContactEmail"("addressNormalized");

-- CreateIndex
CREATE INDEX "ContactEmail_status_idx" ON "ContactEmail"("status");

-- CreateIndex
CREATE UNIQUE INDEX "EmailDelivery_noticeId_userId_key" ON "EmailDelivery"("noticeId", "userId");

-- CreateIndex
CREATE INDEX "EmailDelivery_status_nextAttemptAt_idx" ON "EmailDelivery"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "EmailDelivery_userId_createdAt_idx" ON "EmailDelivery"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notice_emailFannedOutAt_createdAt_idx" ON "Notice"("emailFannedOutAt", "createdAt");

-- AddForeignKey
ALTER TABLE "ContactEmail" ADD CONSTRAINT "ContactEmail_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
