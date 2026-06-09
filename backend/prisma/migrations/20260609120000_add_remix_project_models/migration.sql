-- CreateTable
CREATE TABLE "RemixProject" (
    "id" TEXT NOT NULL,
    "creatorUserId" TEXT NOT NULL,
    "sourceTrackId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "mode" TEXT NOT NULL DEFAULT 'stem_mix',
    "licenseType" "LicenseType" NOT NULL DEFAULT 'remix',
    "licenseId" TEXT,
    "prompt" TEXT,
    "generationProvider" TEXT,
    "generationJobId" TEXT,
    "generationMetadata" JSONB,
    "attribution" TEXT,
    "exportPolicy" JSONB,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RemixProject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RemixProjectStem" (
    "id" TEXT NOT NULL,
    "remixProjectId" TEXT NOT NULL,
    "stemId" TEXT NOT NULL,
    "role" TEXT,
    "gainDb" DOUBLE PRECISION,
    "muted" BOOLEAN NOT NULL DEFAULT false,
    "arrangement" JSONB,

    CONSTRAINT "RemixProjectStem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemixProject_creatorUserId_createdAt_idx" ON "RemixProject"("creatorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "RemixProject_sourceTrackId_idx" ON "RemixProject"("sourceTrackId");

-- CreateIndex
CREATE INDEX "RemixProjectStem_stemId_idx" ON "RemixProjectStem"("stemId");

-- CreateIndex
CREATE UNIQUE INDEX "RemixProjectStem_remixProjectId_stemId_key" ON "RemixProjectStem"("remixProjectId", "stemId");

-- AddForeignKey
ALTER TABLE "RemixProject" ADD CONSTRAINT "RemixProject_creatorUserId_fkey" FOREIGN KEY ("creatorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemixProject" ADD CONSTRAINT "RemixProject_sourceTrackId_fkey" FOREIGN KEY ("sourceTrackId") REFERENCES "Track"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemixProjectStem" ADD CONSTRAINT "RemixProjectStem_remixProjectId_fkey" FOREIGN KEY ("remixProjectId") REFERENCES "RemixProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemixProjectStem" ADD CONSTRAINT "RemixProjectStem_stemId_fkey" FOREIGN KEY ("stemId") REFERENCES "Stem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
