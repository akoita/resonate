-- Mashups (#2558): an optional second source track and its conform recipe.
ALTER TABLE "RemixProject" ADD COLUMN "secondarySourceTrackId" TEXT;
ALTER TABLE "RemixProject" ADD COLUMN "mashup" JSONB;

-- CreateIndex
CREATE INDEX "RemixProject_secondarySourceTrackId_idx" ON "RemixProject"("secondarySourceTrackId");

-- AddForeignKey
ALTER TABLE "RemixProject" ADD CONSTRAINT "RemixProject_secondarySourceTrackId_fkey" FOREIGN KEY ("secondarySourceTrackId") REFERENCES "Track"("id") ON DELETE SET NULL ON UPDATE CASCADE;
