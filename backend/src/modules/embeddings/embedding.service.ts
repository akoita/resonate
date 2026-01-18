import { Injectable } from "@nestjs/common";

@Injectable()
export class EmbeddingService {
  private readonly dimension = 16;

  embed(text: string) {
    const vector = new Array(this.dimension).fill(0);
    const tokens = text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    if (tokens.length === 0) {
      return vector;
    }
    tokens.forEach((token) => {
      const hash = this.hash(token);
      const index = hash % this.dimension;
      vector[index] += 1;
    });
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0)) || 1;
    return vector.map((val) => val / norm);
  }

  private hash(value: string) {
    let hash = 0;
    for (let i = 0; i < value.length; i += 1) {
      hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
    }
    return hash;
  }
}
