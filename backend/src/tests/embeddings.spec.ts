import { EmbeddingService } from "../modules/embeddings/embedding.service";
import { EmbeddingStore } from "../modules/embeddings/embedding.store";

describe("embeddings", () => {
  it("computes similarity scores", () => {
    const service = new EmbeddingService();
    const store = new EmbeddingStore();
    const a = service.embed("lofi chill");
    const b = service.embed("chill beats");
    const c = service.embed("metal");
    store.upsert("track-a", a);
    store.upsert("track-b", b);
    store.upsert("track-c", c);

    const ranked = store.similarity(a, ["track-a", "track-b", "track-c"]);
    expect(ranked[0].trackId).toBe("track-a");
  });
});
