-- Same-name artist profiles that were created from a credit name alone and that
-- nobody has claimed are one artist. Earlier, a second profile under a name made
-- every credit with that name "ambiguous", which keeps the artist out of
-- identity-keyed rankings (Top Artists) until an operator reviews each credit.
--
-- Repoint such credits to the oldest profile of the name and mark them
-- "inferred". A name is left for operator review when any profile under it is a
-- manager account, has an account behind it, is claimed, or when the profiles
-- carry different reference identifiers. Duplicate profile rows are kept: other
-- records may reference them.

WITH name_groups AS (
  SELECT
    LOWER("displayName") AS name_key,
    BOOL_AND(
      "profileType" = 'public_artist'
      AND "userId" IS NULL
      AND "claimStatus" = 'unclaimed'
    ) AS all_unclaimed,
    COUNT(DISTINCT "musicbrainzArtistId") AS reference_ids
  FROM "Artist"
  GROUP BY LOWER("displayName")
),
targets AS (
  SELECT DISTINCT ON (LOWER(artist."displayName"))
    LOWER(artist."displayName") AS name_key,
    artist."id" AS target_id
  FROM "Artist" AS artist
  JOIN name_groups ON name_groups.name_key = LOWER(artist."displayName")
  WHERE name_groups.all_unclaimed AND name_groups.reference_ids <= 1
  ORDER BY LOWER(artist."displayName"), artist."createdAt" ASC, artist."id" ASC
)
UPDATE "ReleaseArtistCredit" AS credit
SET "artistId" = targets.target_id,
    "identityStatus" = 'inferred',
    "updatedAt" = NOW()
FROM "Artist" AS linked_artist, targets
WHERE credit."identityStatus" = 'ambiguous'
  AND credit."artistId" = linked_artist."id"
  AND LOWER(credit."displayName") = LOWER(linked_artist."displayName")
  AND targets.name_key = LOWER(linked_artist."displayName")
  AND NOT EXISTS (
    SELECT 1
    FROM "ReleaseArtistCredit" AS other
    WHERE other."id" <> credit."id"
      AND other."releaseId" = credit."releaseId"
      AND other."role" = credit."role"
      AND other."sortOrder" = credit."sortOrder"
      AND LOWER(other."displayName") = LOWER(credit."displayName")
  );

