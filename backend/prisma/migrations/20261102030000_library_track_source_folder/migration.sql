-- Local files across devices: the name of the library folder a file was found
-- in, so another device can offer to add the same folder. A name only; the
-- browser never reveals where the folder sits on disk.
ALTER TABLE "LibraryTrack" ADD COLUMN "sourceFolder" TEXT;
