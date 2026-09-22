BEGIN;

ALTER TABLE "ReleaseArtistCredit"
  ADD COLUMN "identityStatus" TEXT NOT NULL DEFAULT 'inferred';

UPDATE "ReleaseArtistCredit" AS credit
SET "identityStatus" = 'ambiguous'
FROM "Artist" AS linked_artist
WHERE credit."artistId" = linked_artist."id"
  AND (
    linked_artist."profileType" <> 'public_artist'
    OR linked_artist."userId" IS NOT NULL
    OR
    LOWER(credit."displayName") <> LOWER(linked_artist."displayName")
    OR EXISTS (
      SELECT 1
      FROM "Artist" AS duplicate_artist
      WHERE duplicate_artist."id" <> linked_artist."id"
        AND LOWER(duplicate_artist."displayName") = LOWER(linked_artist."displayName")
    )
  );

DELETE FROM "ArtistEngagement";

COMMIT;
