ALTER TABLE "ShowCampaign" ADD COLUMN "sourceReleaseId" TEXT;

CREATE INDEX "ShowCampaign_sourceReleaseId_idx" ON "ShowCampaign"("sourceReleaseId");

ALTER TABLE "ShowCampaign"
  ADD CONSTRAINT "ShowCampaign_sourceReleaseId_fkey"
  FOREIGN KEY ("sourceReleaseId") REFERENCES "Release"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
