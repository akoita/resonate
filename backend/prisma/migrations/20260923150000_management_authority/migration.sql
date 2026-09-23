-- #1762: management ownership, scoped grants, and transfer snapshots.
-- Nullable owner overrides preserve the existing Artist.userId and
-- Release.artist -> Artist.userId management fallback without a data rewrite.
BEGIN;

CREATE TYPE "ManagementScope" AS ENUM (
    'PROFILE_EDIT',
    'CATALOG_READ',
    'CATALOG_METADATA',
    'CATALOG_MEDIA'
);

CREATE TYPE "ManagementGrantStatus" AS ENUM ('pending', 'active', 'declined', 'revoked');
CREATE TYPE "ManagementResourceType" AS ENUM ('artist_profile', 'release');
CREATE TYPE "ManagementTransferStatus" AS ENUM ('pending', 'accepted', 'declined', 'cancelled');

ALTER TABLE "Artist"
    ADD COLUMN "managementOwnerUserId" TEXT;

ALTER TABLE "Release"
    ADD COLUMN "managementOwnerUserId" TEXT;

CREATE INDEX "Artist_managementOwnerUserId_idx"
    ON "Artist"("managementOwnerUserId");

CREATE INDEX "Release_managementOwnerUserId_idx"
    ON "Release"("managementOwnerUserId");

CREATE INDEX "Release_artistId_idx"
    ON "Release"("artistId");

ALTER TABLE "Artist"
    ADD CONSTRAINT "Artist_managementOwnerUserId_fkey"
    FOREIGN KEY ("managementOwnerUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Release"
    ADD CONSTRAINT "Release_managementOwnerUserId_fkey"
    FOREIGN KEY ("managementOwnerUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ManagementGrant" (
    "id" TEXT NOT NULL,
    "artistId" TEXT,
    "releaseId" TEXT,
    "granteeUserId" TEXT NOT NULL,
    "inviterUserId" TEXT NOT NULL,
    "scopes" "ManagementScope"[] NOT NULL,
    "status" "ManagementGrantStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementGrant_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ManagementGrant_exactly_one_resource_check"
        CHECK (num_nonnulls("artistId", "releaseId") = 1)
);

CREATE INDEX "ManagementGrant_artistId_status_idx"
    ON "ManagementGrant"("artistId", "status");

CREATE INDEX "ManagementGrant_releaseId_status_idx"
    ON "ManagementGrant"("releaseId", "status");

CREATE INDEX "ManagementGrant_granteeUserId_status_expiresAt_idx"
    ON "ManagementGrant"("granteeUserId", "status", "expiresAt");

CREATE INDEX "ManagementGrant_inviterUserId_createdAt_idx"
    ON "ManagementGrant"("inviterUserId", "createdAt");

CREATE INDEX "ManagementGrant_scopes_idx"
    ON "ManagementGrant" USING GIN ("scopes");

ALTER TABLE "ManagementGrant"
    ADD CONSTRAINT "ManagementGrant_artistId_fkey"
    FOREIGN KEY ("artistId") REFERENCES "Artist"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManagementGrant"
    ADD CONSTRAINT "ManagementGrant_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "Release"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ManagementGrant"
    ADD CONSTRAINT "ManagementGrant_granteeUserId_fkey"
    FOREIGN KEY ("granteeUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManagementGrant"
    ADD CONSTRAINT "ManagementGrant_inviterUserId_fkey"
    FOREIGN KEY ("inviterUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "ManagementTransfer" (
    "id" TEXT NOT NULL,
    "proposerUserId" TEXT NOT NULL,
    "recipientUserId" TEXT NOT NULL,
    "resourceType" "ManagementResourceType" NOT NULL,
    "resourceIds" TEXT[] NOT NULL,
    "status" "ManagementTransferStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ManagementTransfer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ManagementTransfer_proposerUserId_status_createdAt_idx"
    ON "ManagementTransfer"("proposerUserId", "status", "createdAt");

CREATE INDEX "ManagementTransfer_recipientUserId_status_createdAt_idx"
    ON "ManagementTransfer"("recipientUserId", "status", "createdAt");

CREATE INDEX "ManagementTransfer_resourceType_createdAt_idx"
    ON "ManagementTransfer"("resourceType", "createdAt");

ALTER TABLE "ManagementTransfer"
    ADD CONSTRAINT "ManagementTransfer_proposerUserId_fkey"
    FOREIGN KEY ("proposerUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ManagementTransfer"
    ADD CONSTRAINT "ManagementTransfer_recipientUserId_fkey"
    FOREIGN KEY ("recipientUserId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE;

COMMIT;
