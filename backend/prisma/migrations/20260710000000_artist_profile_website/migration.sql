-- #1419 WI-1: editable artist profile — add website column.
-- imageUrl/summary/socialLinks already existed; website was the only gap.

ALTER TABLE "Artist" ADD COLUMN "website" TEXT;
