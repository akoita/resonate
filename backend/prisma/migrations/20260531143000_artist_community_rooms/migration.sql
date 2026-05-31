-- CreateTable
CREATE TABLE "CommunityRoom" (
    "id" TEXT NOT NULL,
    "roomType" TEXT NOT NULL,
    "ownerType" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "artistId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "accessPolicyJson" JSONB,
    "status" TEXT NOT NULL DEFAULT 'active',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityRoom_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMembership" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'member',
    "sourceType" TEXT NOT NULL DEFAULT 'manual',
    "status" TEXT NOT NULL DEFAULT 'active',
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityMessage" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "messageType" TEXT NOT NULL DEFAULT 'message',
    "status" TEXT NOT NULL DEFAULT 'visible',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CommunityMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityModerationReport" (
    "id" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "messageId" TEXT,
    "reporterUserId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "CommunityModerationReport_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunityRoom_identity" ON "CommunityRoom"("roomType", "ownerType", "ownerId");

-- CreateIndex
CREATE INDEX "CommunityRoom_artistId_status_idx" ON "CommunityRoom"("artistId", "status");

-- CreateIndex
CREATE INDEX "CommunityRoom_ownerType_ownerId_status_idx" ON "CommunityRoom"("ownerType", "ownerId", "status");

-- CreateIndex
CREATE INDEX "CommunityRoom_roomType_status_idx" ON "CommunityRoom"("roomType", "status");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityMembership_identity" ON "CommunityMembership"("roomId", "userId");

-- CreateIndex
CREATE INDEX "CommunityMembership_userId_status_idx" ON "CommunityMembership"("userId", "status");

-- CreateIndex
CREATE INDEX "CommunityMembership_roomId_status_idx" ON "CommunityMembership"("roomId", "status");

-- CreateIndex
CREATE INDEX "CommunityMessage_roomId_status_createdAt_idx" ON "CommunityMessage"("roomId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityMessage_authorId_createdAt_idx" ON "CommunityMessage"("authorId", "createdAt");

-- CreateIndex
CREATE INDEX "CommunityMessage_messageType_idx" ON "CommunityMessage"("messageType");

-- CreateIndex
CREATE INDEX "CommunityModerationReport_roomId_status_idx" ON "CommunityModerationReport"("roomId", "status");

-- CreateIndex
CREATE INDEX "CommunityModerationReport_messageId_status_idx" ON "CommunityModerationReport"("messageId", "status");

-- CreateIndex
CREATE INDEX "CommunityModerationReport_reporterUserId_createdAt_idx" ON "CommunityModerationReport"("reporterUserId", "createdAt");

-- AddForeignKey
ALTER TABLE "CommunityRoom" ADD CONSTRAINT "CommunityRoom_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CommunityRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMembership" ADD CONSTRAINT "CommunityMembership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMessage" ADD CONSTRAINT "CommunityMessage_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CommunityRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityMessage" ADD CONSTRAINT "CommunityMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityModerationReport" ADD CONSTRAINT "CommunityModerationReport_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "CommunityRoom"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityModerationReport" ADD CONSTRAINT "CommunityModerationReport_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "CommunityMessage"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityModerationReport" ADD CONSTRAINT "CommunityModerationReport_reporterUserId_fkey" FOREIGN KEY ("reporterUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
