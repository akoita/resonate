import { EmbeddingService } from "../modules/embeddings/embedding.service";

describe("embeddings", () => {
  it("embeds similar text into reusable normalized vectors", () => {
    const service = new EmbeddingService();
    const a = service.embed("lofi chill");
    const b = service.embed("chill beats");

    expect(a).toHaveLength(16);
    expect(b).toHaveLength(16);
    expect(a.reduce((sum, val) => sum + val * val, 0)).toBeCloseTo(1);
    expect(b.reduce((sum, val) => sum + val * val, 0)).toBeCloseTo(1);
  });
});
