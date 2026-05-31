-- Split release manager ownership from public release artist credits.
-- Release.artistId remains the manager/uploader owner during this compatibility
-- slice. ReleaseArtistCredit stores first-class public artist identities.

ALTER TABLE "Artist" ALTER COLUMN "userId" DROP NOT NULL;
ALTER TABLE "Artist" ALTER COLUMN "payoutAddress" DROP NOT NULL;
ALTER TABLE "Artist" ADD COLUMN "profileType" TEXT NOT NULL DEFAULT 'manager';
ALTER TABLE "Artist" ADD COLUMN "claimStatus" TEXT NOT NULL DEFAULT 'claimed';
ALTER TABLE "Artist" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Artist" ADD COLUMN "summary" TEXT;
ALTER TABLE "Artist" ADD COLUMN "socialLinks" JSONB;
ALTER TABLE "Artist" ADD COLUMN "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "Artist" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "ReleaseArtistCredit" (
    "id" TEXT NOT NULL,
    "releaseId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReleaseArtistCredit_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Artist_displayName_idx" ON "Artist"("displayName");
CREATE INDEX "Artist_profileType_claimStatus_idx" ON "Artist"("profileType", "claimStatus");
CREATE UNIQUE INDEX "ReleaseArtistCredit_releaseId_role_artistId_sortOrder_key"
    ON "ReleaseArtistCredit"("releaseId", "role", "artistId", "sortOrder");
CREATE INDEX "ReleaseArtistCredit_artistId_role_idx" ON "ReleaseArtistCredit"("artistId", "role");
CREATE INDEX "ReleaseArtistCredit_releaseId_role_sortOrder_idx" ON "ReleaseArtistCredit"("releaseId", "role", "sortOrder");
CREATE INDEX "ReleaseArtistCredit_displayName_role_idx" ON "ReleaseArtistCredit"("displayName", "role");

ALTER TABLE "ReleaseArtistCredit"
    ADD CONSTRAINT "ReleaseArtistCredit_releaseId_fkey"
    FOREIGN KEY ("releaseId") REFERENCES "Release"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "ReleaseArtistCredit"
    ADD CONSTRAINT "ReleaseArtistCredit_artistId_fkey"
    FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

WITH primary_names AS (
    SELECT DISTINCT trim("primaryArtist") AS "displayName"
    FROM "Release"
    WHERE "primaryArtist" IS NOT NULL AND trim("primaryArtist") <> ''
),
missing_primary_artists AS (
    SELECT
        'public_artist_' || md5(lower("displayName")) AS "id",
        "displayName"
    FROM primary_names p
    WHERE NOT EXISTS (
        SELECT 1 FROM "Artist" a
        WHERE lower(a."displayName") = lower(p."displayName")
    )
)
INSERT INTO "Artist" (
    "id",
    "userId",
    "displayName",
    "payoutAddress",
    "profileType",
    "claimStatus",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    NULL,
    "displayName",
    NULL,
    'public_artist',
    'unclaimed',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM missing_primary_artists
ON CONFLICT ("id") DO NOTHING;

WITH featured_names AS (
    SELECT DISTINCT trim(name) AS "displayName"
    FROM "Release" r
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(r."featuredArtists", ''), ',') AS name
    WHERE trim(name) <> ''
),
missing_featured_artists AS (
    SELECT
        'public_artist_' || md5(lower("displayName")) AS "id",
        "displayName"
    FROM featured_names f
    WHERE NOT EXISTS (
        SELECT 1 FROM "Artist" a
        WHERE lower(a."displayName") = lower(f."displayName")
    )
)
INSERT INTO "Artist" (
    "id",
    "userId",
    "displayName",
    "payoutAddress",
    "profileType",
    "claimStatus",
    "createdAt",
    "updatedAt"
)
SELECT
    "id",
    NULL,
    "displayName",
    NULL,
    'public_artist',
    'unclaimed',
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM missing_featured_artists
ON CONFLICT ("id") DO NOTHING;

WITH primary_credit_source AS (
    SELECT
        r."id" AS "releaseId",
        trim(COALESCE(NULLIF(r."primaryArtist", ''), a."displayName")) AS "displayName",
        0 AS "sortOrder"
    FROM "Release" r
    JOIN "Artist" a ON a."id" = r."artistId"
),
primary_credit_artist AS (
    SELECT DISTINCT ON (s."releaseId")
        s."releaseId",
        pa."id" AS "artistId",
        s."displayName",
        s."sortOrder"
    FROM primary_credit_source s
    JOIN "Artist" pa ON lower(pa."displayName") = lower(s."displayName")
    ORDER BY s."releaseId", CASE WHEN pa."profileType" = 'public_artist' THEN 0 ELSE 1 END, pa."createdAt" ASC
)
INSERT INTO "ReleaseArtistCredit" (
    "id",
    "releaseId",
    "artistId",
    "role",
    "displayName",
    "sortOrder",
    "createdAt",
    "updatedAt"
)
SELECT
    'release_credit_' || md5("releaseId" || ':main:' || "artistId" || ':0'),
    "releaseId",
    "artistId",
    'main',
    "displayName",
    "sortOrder",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM primary_credit_artist
ON CONFLICT ("releaseId", "role", "artistId", "sortOrder") DO NOTHING;

WITH featured_credit_source AS (
    SELECT
        r."id" AS "releaseId",
        trim(name) AS "displayName",
        ordinality::integer AS "sortOrder"
    FROM "Release" r
    CROSS JOIN LATERAL regexp_split_to_table(COALESCE(r."featuredArtists", ''), ',')
        WITH ORDINALITY AS featured(name, ordinality)
    WHERE trim(name) <> ''
),
featured_credit_artist AS (
    SELECT DISTINCT ON (s."releaseId", s."sortOrder")
        s."releaseId",
        pa."id" AS "artistId",
        s."displayName",
        s."sortOrder"
    FROM featured_credit_source s
    JOIN "Artist" pa ON lower(pa."displayName") = lower(s."displayName")
    ORDER BY s."releaseId", s."sortOrder", CASE WHEN pa."profileType" = 'public_artist' THEN 0 ELSE 1 END, pa."createdAt" ASC
)
INSERT INTO "ReleaseArtistCredit" (
    "id",
    "releaseId",
    "artistId",
    "role",
    "displayName",
    "sortOrder",
    "createdAt",
    "updatedAt"
)
SELECT
    'release_credit_' || md5("releaseId" || ':featured:' || "artistId" || ':' || "sortOrder"::text),
    "releaseId",
    "artistId",
    'featured',
    "displayName",
    "sortOrder",
    CURRENT_TIMESTAMP,
    CURRENT_TIMESTAMP
FROM featured_credit_artist
ON CONFLICT ("releaseId", "role", "artistId", "sortOrder") DO NOTHING;
