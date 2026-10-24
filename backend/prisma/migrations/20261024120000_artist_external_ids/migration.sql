-- #2258 durable artist identity signal: the MusicBrainz artist id and Wikidata
-- QID that artist enrichment matched, with the match confidence and the time of
-- the match. The #2252 catalog attestation report prefers these over URL-host
-- inference. All columns are nullable and there is no backfill: enrichment
-- repopulates them the next time it runs for an artist.

-- AlterTable
ALTER TABLE "Artist"
    ADD COLUMN "musicbrainzArtistId" VARCHAR(36),
    ADD COLUMN "wikidataQid" VARCHAR(16),
    ADD COLUMN "externalIdMatchConfidence" VARCHAR(16),
    ADD COLUMN "externalIdMatchedAt" TIMESTAMP(3);
