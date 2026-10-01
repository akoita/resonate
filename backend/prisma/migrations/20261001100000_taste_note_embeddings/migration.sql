-- #2006 / #2003: embeddings of listeners' written taste notes, so a confirmed
-- `note` control can steer Home through embedding nearest-neighbour search.
--
-- Only the vector is stored here; the note text stays on
-- "ListenerTasteSignalControl"."value". Rows are removed with their control.
-- Same 768-dim cosine space as "TrackEmbedding" (see
-- 20260928100000_track_embeddings_vertex_768_hnsw). No ANN index: each listener
-- holds a handful of notes, read by control id.
CREATE TABLE "ListenerTasteNoteEmbedding" (
    "controlId" TEXT NOT NULL,
    "vector" vector(768) NOT NULL,
    "model" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ListenerTasteNoteEmbedding_pkey" PRIMARY KEY ("controlId")
);

CREATE INDEX "ListenerTasteNoteEmbedding_model_idx" ON "ListenerTasteNoteEmbedding"("model");

ALTER TABLE "ListenerTasteNoteEmbedding"
  ADD CONSTRAINT "ListenerTasteNoteEmbedding_controlId_fkey"
  FOREIGN KEY ("controlId") REFERENCES "ListenerTasteSignalControl"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
