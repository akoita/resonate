import { TRACK_EMBEDDING_DIMENSION } from "./embedding.config";

/**
 * Deterministic hashed bag-of-words embedder (768 dims).
 *
 * Only used for `TRACK_EMBEDDING_PROVIDER=hash`: an offline/local fallback that
 * needs no network or credentials and gives reproducible vectors for tests.
 * It is lexical, not semantic; its vectors are stored under their own model id
 * (`hash-v1`) and are never compared with real model vectors.
 */
export class HashEmbedder {
  private readonly dimension = TRACK_EMBEDDING_DIMENSION;

  embed(text: string): number[] {
    const vector = new Array<number>(this.dimension).fill(0);
    let tokens = text
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(Boolean);
    if (tokens.length === 0) {
      // Keep the vector non-zero: cosine distance is undefined for zero vectors.
      tokens = ["∅"];
    }
    for (const token of tokens) {
      vector[this.hash(token) % this.dimension] += 1;
    }
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
    return vector.map((val) => val / norm);
  }

  private hash(value: string): number {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  }
}
