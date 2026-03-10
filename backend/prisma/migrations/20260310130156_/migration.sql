-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "disputeId" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationPreference" (
    "walletAddress" TEXT NOT NULL,
    "disputeFiled" BOOLEAN NOT NULL DEFAULT true,
    "disputeResolved" BOOLEAN NOT NULL DEFAULT true,
    "disputeAppealed" BOOLEAN NOT NULL DEFAULT true,
    "evidenceSubmitted" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "NotificationPreference_pkey" PRIMARY KEY ("walletAddress")
);

-- CreateIndex
CREATE INDEX "Notification_walletAddress_read_idx" ON "Notification"("walletAddress", "read");

-- CreateIndex
CREATE INDEX "Notification_walletAddress_createdAt_idx" ON "Notification"("walletAddress", "createdAt");
