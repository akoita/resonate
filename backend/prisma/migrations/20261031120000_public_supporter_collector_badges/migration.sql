-- #1106: opt-in public supporter and collector badge display (additive only).
ALTER TABLE "CommunityVisibilitySettings" ADD COLUMN "showSupporterBadges" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CommunityVisibilitySettings" ADD COLUMN "showCollectorBadges" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CommunityBadge" ADD COLUMN "expiresAt" TIMESTAMP(3);
