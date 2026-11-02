-- Richer tags for the listener's own files, read on import or set in
-- Resonate's editor (the files themselves are never written): album position,
-- so a local album plays in order, and the credits a release upload also reads.
-- All nullable; rows imported earlier fill in on the next scan of their folder.
ALTER TABLE "LibraryTrack" ADD COLUMN "trackNumber" INTEGER;
ALTER TABLE "LibraryTrack" ADD COLUMN "discNumber" INTEGER;
ALTER TABLE "LibraryTrack" ADD COLUMN "label" TEXT;
ALTER TABLE "LibraryTrack" ADD COLUMN "copyright" TEXT;
ALTER TABLE "LibraryTrack" ADD COLUMN "isrc" TEXT;
ALTER TABLE "LibraryTrack" ADD COLUMN "composer" TEXT;
ALTER TABLE "LibraryTrack" ADD COLUMN "producer" TEXT;
