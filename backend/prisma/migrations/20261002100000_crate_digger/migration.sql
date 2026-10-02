-- #1962 (Crate Digger, docs/rfc/taste-engine.md section 5): saved crates, their
-- items, and the crate request log.
--
-- "CrateRequest" stores counts and filter keys only (the "searched but missing"
-- demand signal, RFC section 6.3); the DJ's free text is never stored.
-- "CrateRequest"."referenceTrackId" has no foreign key on purpose. Generated
-- with `prisma migrate diff` against the previous schema; no unrelated drift.

-- CreateTable
CREATE TABLE "Crate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT,
    "filters" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Crate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrateItem" (
    "id" TEXT NOT NULL,
    "crateId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CrateRequest" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "crateId" TEXT,
    "source" TEXT NOT NULL,
    "referenceTrackId" TEXT,
    "filters" JSONB NOT NULL,
    "parserStrategy" TEXT NOT NULL,
    "unparsedCount" INTEGER NOT NULL DEFAULT 0,
    "requestedCount" INTEGER NOT NULL,
    "foundCount" INTEGER NOT NULL,
    "unmetFilters" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CrateRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Crate_userId_updatedAt_idx" ON "Crate"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "CrateItem_crateId_position_idx" ON "CrateItem"("crateId", "position");

-- CreateIndex
CREATE INDEX "CrateItem_userId_idx" ON "CrateItem"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "CrateItem_crateId_trackId_key" ON "CrateItem"("crateId", "trackId");

-- CreateIndex
CREATE INDEX "CrateRequest_userId_createdAt_idx" ON "CrateRequest"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "CrateRequest_createdAt_idx" ON "CrateRequest"("createdAt");

-- AddForeignKey
ALTER TABLE "Crate" ADD CONSTRAINT "Crate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrateItem" ADD CONSTRAINT "CrateItem_crateId_fkey" FOREIGN KEY ("crateId") REFERENCES "Crate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrateItem" ADD CONSTRAINT "CrateItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrateItem" ADD CONSTRAINT "CrateItem_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrateRequest" ADD CONSTRAINT "CrateRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CrateRequest" ADD CONSTRAINT "CrateRequest_crateId_fkey" FOREIGN KEY ("crateId") REFERENCES "Crate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

