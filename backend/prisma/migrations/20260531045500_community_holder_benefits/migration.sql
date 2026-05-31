-- CreateTable
CREATE TABLE "CommunityBadge" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "badgeType" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityRole" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleType" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "visibility" TEXT NOT NULL DEFAULT 'private',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityRole_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityBenefitRule" (
    "id" TEXT NOT NULL,
    "artistId" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "benefitType" TEXT NOT NULL,
    "eligibilityPolicy" JSONB NOT NULL,
    "redemptionPolicy" JSONB,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityBenefitRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommunityBenefitRedemption" (
    "id" TEXT NOT NULL,
    "benefitRuleId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redemptionStatus" TEXT NOT NULL DEFAULT 'redeemed',
    "settlementType" TEXT NOT NULL DEFAULT 'none',
    "settlementReference" TEXT,
    "redeemedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommunityBenefitRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CommunityBadge_identity" ON "CommunityBadge"("userId", "badgeType", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "CommunityBadge_userId_revokedAt_idx" ON "CommunityBadge"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "CommunityBadge_badgeType_sourceType_idx" ON "CommunityBadge"("badgeType", "sourceType");

-- CreateIndex
CREATE INDEX "CommunityBadge_visibility_idx" ON "CommunityBadge"("visibility");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityRole_identity" ON "CommunityRole"("userId", "roleType", "scopeType", "scopeId");

-- CreateIndex
CREATE INDEX "CommunityRole_userId_revokedAt_idx" ON "CommunityRole"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "CommunityRole_roleType_scopeType_idx" ON "CommunityRole"("roleType", "scopeType");

-- CreateIndex
CREATE INDEX "CommunityRole_visibility_idx" ON "CommunityRole"("visibility");

-- CreateIndex
CREATE INDEX "CommunityBenefitRule_artistId_status_idx" ON "CommunityBenefitRule"("artistId", "status");

-- CreateIndex
CREATE INDEX "CommunityBenefitRule_benefitType_status_idx" ON "CommunityBenefitRule"("benefitType", "status");

-- CreateIndex
CREATE INDEX "CommunityBenefitRule_status_startsAt_endsAt_idx" ON "CommunityBenefitRule"("status", "startsAt", "endsAt");

-- CreateIndex
CREATE UNIQUE INDEX "CommunityBenefitRedemption_identity" ON "CommunityBenefitRedemption"("benefitRuleId", "userId");

-- CreateIndex
CREATE INDEX "CommunityBenefitRedemption_userId_redemptionStatus_idx" ON "CommunityBenefitRedemption"("userId", "redemptionStatus");

-- CreateIndex
CREATE INDEX "CommunityBenefitRedemption_benefitRuleId_redemptionStatus_idx" ON "CommunityBenefitRedemption"("benefitRuleId", "redemptionStatus");

-- AddForeignKey
ALTER TABLE "CommunityBadge" ADD CONSTRAINT "CommunityBadge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityRole" ADD CONSTRAINT "CommunityRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBenefitRule" ADD CONSTRAINT "CommunityBenefitRule_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBenefitRedemption" ADD CONSTRAINT "CommunityBenefitRedemption_benefitRuleId_fkey" FOREIGN KEY ("benefitRuleId") REFERENCES "CommunityBenefitRule"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommunityBenefitRedemption" ADD CONSTRAINT "CommunityBenefitRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
