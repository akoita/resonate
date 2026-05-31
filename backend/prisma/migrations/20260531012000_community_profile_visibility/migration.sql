-- Listener community profile and privacy-first visibility controls.
CREATE TABLE "CommunityProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "bio" TEXT,
    "avatarUrl" TEXT,
    "profileVisibility" TEXT NOT NULL DEFAULT 'private',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CommunityVisibilitySettings" (
    "userId" TEXT NOT NULL,
    "showTasteBadges" BOOLEAN NOT NULL DEFAULT false,
    "showOwnedItems" BOOLEAN NOT NULL DEFAULT false,
    "showCampaignSupport" BOOLEAN NOT NULL DEFAULT false,
    "showShowAttendance" BOOLEAN NOT NULL DEFAULT false,
    "showPlaylists" BOOLEAN NOT NULL DEFAULT false,
    "showWalletAddress" BOOLEAN NOT NULL DEFAULT false,
    "allowTasteMatching" BOOLEAN NOT NULL DEFAULT false,
    "allowCityScenes" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityVisibilitySettings_pkey" PRIMARY KEY ("userId")
);

CREATE UNIQUE INDEX "CommunityProfile_userId_key" ON "CommunityProfile"("userId");
CREATE INDEX "CommunityProfile_profileVisibility_updatedAt_idx" ON "CommunityProfile"("profileVisibility", "updatedAt");

ALTER TABLE "CommunityProfile"
    ADD CONSTRAINT "CommunityProfile_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CommunityVisibilitySettings"
    ADD CONSTRAINT "CommunityVisibilitySettings_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
