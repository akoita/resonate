CREATE TABLE "CommunityDiscordBridge" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'discord',
    "serverId" TEXT,
    "serverName" TEXT,
    "channelId" TEXT,
    "channelName" TEXT,
    "webhookUrl" TEXT,
    "webhookUrlMasked" TEXT NOT NULL,
    "inviteUrl" TEXT,
    "publicLinkEnabled" BOOLEAN NOT NULL DEFAULT false,
    "announcementMirrorEnabled" BOOLEAN NOT NULL DEFAULT false,
    "roleSyncEnabled" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "lastTestedAt" TIMESTAMP(3),
    "lastMirroredAt" TIMESTAMP(3),
    "lastRoleSyncAt" TIMESTAMP(3),
    "lastFailureAt" TIMESTAMP(3),
    "lastFailureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityDiscordBridge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityDiscordRoleMapping" (
    "id" TEXT NOT NULL,
    "bridgeId" TEXT NOT NULL,
    "resonateRole" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL DEFAULT 'artist',
    "scopeId" TEXT NOT NULL,
    "discordRoleId" TEXT NOT NULL,
    "label" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastSyncedAt" TIMESTAMP(3),
    "lastStatus" TEXT NOT NULL DEFAULT 'pending',
    "lastReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityDiscordRoleMapping_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityDiscordSyncAttempt" (
    "id" TEXT NOT NULL,
    "bridgeId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "messageId" TEXT,
    "roleMappingId" TEXT,
    "retryOfId" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 1,
    "requestSummary" JSONB,
    "responseStatus" INTEGER,
    "errorReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CommunityDiscordSyncAttempt_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CommunityDiscordBridge_artistId_key" ON "CommunityDiscordBridge"("artistId");
CREATE INDEX "CommunityDiscordBridge_artistId_status_idx" ON "CommunityDiscordBridge"("artistId", "status");
CREATE INDEX "CommunityDiscordBridge_publicLinkEnabled_status_idx" ON "CommunityDiscordBridge"("publicLinkEnabled", "status");

CREATE UNIQUE INDEX "CommunityDiscordRoleMapping_identity" ON "CommunityDiscordRoleMapping"("bridgeId", "resonateRole", "scopeType", "scopeId", "discordRoleId");
CREATE INDEX "CommunityDiscordRoleMapping_bridgeId_enabled_idx" ON "CommunityDiscordRoleMapping"("bridgeId", "enabled");
CREATE INDEX "CommunityDiscordRoleMapping_resonateRole_scopeType_scopeId_idx" ON "CommunityDiscordRoleMapping"("resonateRole", "scopeType", "scopeId");

CREATE INDEX "CommunityDiscordSyncAttempt_bridgeId_action_status_createdAt_idx" ON "CommunityDiscordSyncAttempt"("bridgeId", "action", "status", "createdAt");
CREATE INDEX "CommunityDiscordSyncAttempt_messageId_idx" ON "CommunityDiscordSyncAttempt"("messageId");
CREATE INDEX "CommunityDiscordSyncAttempt_roleMappingId_idx" ON "CommunityDiscordSyncAttempt"("roleMappingId");
CREATE INDEX "CommunityDiscordSyncAttempt_retryOfId_idx" ON "CommunityDiscordSyncAttempt"("retryOfId");

ALTER TABLE "CommunityDiscordBridge"
  ADD CONSTRAINT "CommunityDiscordBridge_artistId_fkey"
  FOREIGN KEY ("artistId") REFERENCES "Artist"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityDiscordRoleMapping"
  ADD CONSTRAINT "CommunityDiscordRoleMapping_bridgeId_fkey"
  FOREIGN KEY ("bridgeId") REFERENCES "CommunityDiscordBridge"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityDiscordSyncAttempt"
  ADD CONSTRAINT "CommunityDiscordSyncAttempt_bridgeId_fkey"
  FOREIGN KEY ("bridgeId") REFERENCES "CommunityDiscordBridge"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
