"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const embedding_service_1 = require("../modules/embeddings/embedding.service");
const embedding_store_1 = require("../modules/embeddings/embedding.store");
describe("embeddings", () => {
    it("computes similarity scores", () => {
        const service = new embedding_service_1.EmbeddingService();
        const store = new embedding_store_1.EmbeddingStore();
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
