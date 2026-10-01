-- #1452 (WS-5): replace the 16-dim hashed bag-of-words placeholder embeddings
-- with real text embeddings (768 dims) over track metadata, searched through an
-- HNSW cosine index.
--
-- Existing rows are placeholders produced by the 16-dim hash embedder; they
-- cannot be converted to 768 dims and carry no model/content hash, so they are
-- dropped. `POST /admin/embeddings/backfill` (and embed-on-ingest) repopulate.
DELETE FROM "TrackEmbedding";

ALTER TABLE "TrackEmbedding" DROP COLUMN "vector";
ALTER TABLE "TrackEmbedding" ADD COLUMN "vector" vector(768) NOT NULL;
ALTER TABLE "TrackEmbedding" ADD COLUMN "model" TEXT NOT NULL;
ALTER TABLE "TrackEmbedding" ADD COLUMN "contentHash" TEXT NOT NULL;

CREATE INDEX "TrackEmbedding_model_idx" ON "TrackEmbedding"("model");

-- Approximate nearest-neighbour search by cosine distance (`<=>`). Queries must
-- `ORDER BY "vector" <=> $q LIMIT k` for the planner to use this index.
CREATE INDEX IF NOT EXISTS "TrackEmbedding_vector_hnsw_idx"
  ON "TrackEmbedding" USING hnsw ("vector" vector_cosine_ops);
