-- #2505: per-user client keys for library rows. Until now a client-supplied id
-- was the global primary key, so a save carrying an id another listener
-- already used updated that listener's row. Existing ids become client keys
-- so every id a client or playlist already stores keeps resolving.
ALTER TABLE "LibraryTrack" ADD COLUMN "clientKey" TEXT;

UPDATE "LibraryTrack" SET "clientKey" = "id" WHERE "catalogTrackId" IS NULL;

CREATE UNIQUE INDEX "LibraryTrack_userId_clientKey_key" ON "LibraryTrack"("userId", "clientKey");
