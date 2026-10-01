import { Module } from "@nestjs/common";
import { EmbeddingService } from "./embedding.service";
import { EmbeddingStore } from "./embedding.store";
import { TasteNoteEmbeddingService } from "./taste_note_embedding.service";
import { TrackEmbeddingService } from "./track_embedding.service";

/**
 * Track embeddings (#1452, WS-5). One instance per process so the ingest
 * subscriptions in `TrackEmbeddingService` register exactly once. `EventBus`
 * comes from the global `SharedModule`. Also provides the listener taste-note
 * embeddings (#2006) that Home reads as a candidate source (#2003).
 */
@Module({
  providers: [
    EmbeddingService,
    EmbeddingStore,
    TrackEmbeddingService,
    TasteNoteEmbeddingService,
  ],
  exports: [
    EmbeddingService,
    EmbeddingStore,
    TrackEmbeddingService,
    TasteNoteEmbeddingService,
  ],
})
export class EmbeddingsModule {}
