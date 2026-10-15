-- #2146 platform notices: one row per broadcast (resolved at read time) or per
-- targeted recipient, plus per-user read state.

-- CreateTable
CREATE TABLE "Notice" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "audience" TEXT NOT NULL,
    "recipientUserId" TEXT,
    "dedupeKey" TEXT,
    "effectiveAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NoticeRead" (
    "noticeId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoticeRead_pkey" PRIMARY KEY ("noticeId","userId")
);

-- CreateIndex
CREATE INDEX "Notice_audience_createdAt_idx" ON "Notice"("audience", "createdAt");

-- CreateIndex
CREATE INDEX "Notice_recipientUserId_createdAt_idx" ON "Notice"("recipientUserId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Notice_dedupeKey_recipientUserId_key" ON "Notice"("dedupeKey", "recipientUserId");

-- CreateIndex
CREATE INDEX "NoticeRead_userId_idx" ON "NoticeRead"("userId");

-- AddForeignKey
ALTER TABLE "Notice" ADD CONSTRAINT "Notice_recipientUserId_fkey" FOREIGN KEY ("recipientUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeRead" ADD CONSTRAINT "NoticeRead_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "Notice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NoticeRead" ADD CONSTRAINT "NoticeRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

