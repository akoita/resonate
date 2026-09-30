import { Module } from "@nestjs/common";
import { EmbeddingService } from "./embedding.service";
import { EmbeddingStore } from "./embedding.store";
import { TrackEmbeddingService } from "./track_embedding.service";

/**
 * Track embeddings (#1452, WS-5). One instance per process so the ingest
 * subscriptions in `TrackEmbeddingService` register exactly once. `EventBus`
 * comes from the global `SharedModule`.
 */
@Module({
  providers: [EmbeddingService, EmbeddingStore, TrackEmbeddingService],
  exports: [EmbeddingService, EmbeddingStore, TrackEmbeddingService],
})
export class EmbeddingsModule {}
