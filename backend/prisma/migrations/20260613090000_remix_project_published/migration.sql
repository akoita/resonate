-- Remix Studio E2 (#1196): publishing a completed remix draft creates a
-- catalog release. The project records the release it published to, and the
-- unique constraint makes double-publish unable to attach two projects to one
-- release (the service additionally claims status='draft' conditionally).
ALTER TABLE "RemixProject" ADD COLUMN "publishedReleaseId" TEXT;

CREATE UNIQUE INDEX "RemixProject_publishedReleaseId_key" ON "RemixProject"("publishedReleaseId");

ALTER TABLE "RemixProject" ADD CONSTRAINT "RemixProject_publishedReleaseId_fkey" FOREIGN KEY ("publishedReleaseId") REFERENCES "Release"("id") ON DELETE SET NULL ON UPDATE CASCADE;
