-- AI part takes and the remix-parts/v1 recipe on the project (#1901).
-- AlterTable
ALTER TABLE "RemixProject" ADD COLUMN     "parts" JSONB;

-- CreateTable
CREATE TABLE "RemixPartTake" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "bars" INTEGER NOT NULL,
    "style" VARCHAR(80),
    "seed" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "promptVersion" TEXT NOT NULL,
    "provider" TEXT,
    "model" TEXT,
    "grounding" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL,
    "storageUri" TEXT,
    "mimeType" TEXT,
    "durationSec" DOUBLE PRECISION,
    "conform" JSONB,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "RemixPartTake_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RemixPartTake_projectId_createdAt_idx" ON "RemixPartTake"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "RemixPartTake_userId_idx" ON "RemixPartTake"("userId");

-- AddForeignKey
ALTER TABLE "RemixPartTake" ADD CONSTRAINT "RemixPartTake_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "RemixProject"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RemixPartTake" ADD CONSTRAINT "RemixPartTake_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
