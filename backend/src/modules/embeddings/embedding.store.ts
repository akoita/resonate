import { Injectable } from "@nestjs/common";

@Injectable()
export class EmbeddingStore {
  private embeddings = new Map<string, number[]>();

  upsert(trackId: string, vector: number[]) {
    this.embeddings.set(trackId, vector);
  }

  get(trackId: string) {
    return this.embeddings.get(trackId) ?? null;
  }

  similarity(query: number[], candidates: string[]) {
    const scored = candidates
      .map((trackId) => {
        const vector = this.embeddings.get(trackId);
        if (!vector) {
          return null;
        }
        return { trackId, score: this.cosine(query, vector) };
      })
      .filter(Boolean) as { trackId: string; score: number }[];
    return scored.sort((a, b) => b.score - a.score);
  }

  private cosine(a: number[], b: number[]) {
    let dot = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i += 1) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    if (!normA || !normB) {
      return 0;
    }
    return dot / Math.sqrt(normA * normB);
  }
}
