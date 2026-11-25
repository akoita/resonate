-- Invitation-only registration, founding-artist cap and waiting list (#2662).

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "codeHint" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "maxUses" INTEGER NOT NULL DEFAULT 1,
    "useCount" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdByUserId" TEXT NOT NULL,
    "issuedBy" TEXT NOT NULL DEFAULT 'operator',
    "waitlistEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvitationRedemption" (
    "id" TEXT NOT NULL,
    "invitationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitationRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "consentVersion" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT,
    "invitedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_codeHash_key" ON "Invitation"("codeHash");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_waitlistEntryId_key" ON "Invitation"("waitlistEntryId");

-- CreateIndex
CREATE INDEX "Invitation_createdByUserId_idx" ON "Invitation"("createdByUserId");

-- CreateIndex
CREATE INDEX "Invitation_createdAt_idx" ON "Invitation"("createdAt");

-- CreateIndex
CREATE INDEX "InvitationRedemption_userId_idx" ON "InvitationRedemption"("userId");

-- CreateIndex
CREATE INDEX "InvitationRedemption_role_idx" ON "InvitationRedemption"("role");

-- CreateIndex
CREATE UNIQUE INDEX "InvitationRedemption_invitationId_userId_key" ON "InvitationRedemption"("invitationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "WaitlistEntry_emailNormalized_key" ON "WaitlistEntry"("emailNormalized");

-- CreateIndex
CREATE INDEX "WaitlistEntry_userId_idx" ON "WaitlistEntry"("userId");

-- CreateIndex
CREATE INDEX "WaitlistEntry_createdAt_idx" ON "WaitlistEntry"("createdAt");

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_waitlistEntryId_fkey" FOREIGN KEY ("waitlistEntryId") REFERENCES "WaitlistEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationRedemption" ADD CONSTRAINT "InvitationRedemption_invitationId_fkey" FOREIGN KEY ("invitationId") REFERENCES "Invitation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvitationRedemption" ADD CONSTRAINT "InvitationRedemption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
