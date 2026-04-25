-- Persist agent similarity embeddings in Postgres using pgvector.
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE "TrackEmbedding" (
    "trackId" TEXT NOT NULL,
    "vector" vector(16) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TrackEmbedding_pkey" PRIMARY KEY ("trackId"),
    CONSTRAINT "TrackEmbedding_trackId_fkey" FOREIGN KEY ("trackId") REFERENCES "Track"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "TrackEmbedding_updatedAt_idx" ON "TrackEmbedding"("updatedAt");

-- Exact cosine search is the safest first step for the current small candidate
-- sets. Add HNSW/IVFFlat when query volume or corpus size warrants it.
