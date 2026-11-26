-- #2682: an artist's approval or decline of one AI-assisted remix version.
CREATE TABLE "RemixApprovalRequest" (
    "id" TEXT NOT NULL,
    "remixProjectId" TEXT NOT NULL,
    "sourceArtistId" TEXT NOT NULL,
    "requesterUserId" TEXT NOT NULL,
    "versionKey" TEXT NOT NULL,
    "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
    "message" VARCHAR(500),
    "reason" VARCHAR(500),
    "decidedByUserId" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemixApprovalRequest_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RemixApprovalRequest_remixProjectId_sourceArtistId_versionKey_key" ON "RemixApprovalRequest"("remixProjectId", "sourceArtistId", "versionKey");

CREATE INDEX "RemixApprovalRequest_sourceArtistId_status_createdAt_idx" ON "RemixApprovalRequest"("sourceArtistId", "status", "createdAt");

CREATE INDEX "RemixApprovalRequest_requesterUserId_idx" ON "RemixApprovalRequest"("requesterUserId");

ALTER TABLE "RemixApprovalRequest" ADD CONSTRAINT "RemixApprovalRequest_remixProjectId_fkey" FOREIGN KEY ("remixProjectId") REFERENCES "RemixProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RemixApprovalRequest" ADD CONSTRAINT "RemixApprovalRequest_sourceArtistId_fkey" FOREIGN KEY ("sourceArtistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "RemixApprovalRequest" ADD CONSTRAINT "RemixApprovalRequest_requesterUserId_fkey" FOREIGN KEY ("requesterUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
