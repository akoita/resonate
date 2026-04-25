import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

export interface EmbeddingScore {
  trackId: string;
  score: number;
}

interface EmbeddingRow {
  trackId: string;
  vector: string;
}

interface SimilarityRow {
  trackId: string;
  score: number;
}

@Injectable()
export class EmbeddingStore {
  private readonly dimension = 16;

  async upsert(trackId: string, vector: number[]) {
    this.assertVector(vector);
    const literal = this.toVectorLiteral(vector);
    await prisma.$executeRaw`
      INSERT INTO "TrackEmbedding" ("trackId", "vector", "updatedAt")
      VALUES (${trackId}, ${literal}::vector, NOW())
      ON CONFLICT ("trackId") DO UPDATE
      SET "vector" = EXCLUDED."vector",
          "updatedAt" = NOW()
    `;
  }

  async get(trackId: string) {
    const rows = await prisma.$queryRaw<EmbeddingRow[]>`
      SELECT "trackId", "vector"::text AS "vector"
      FROM "TrackEmbedding"
      WHERE "trackId" = ${trackId}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? this.parseVector(row.vector) : null;
  }

  async similarity(query: number[], candidates: string[]): Promise<EmbeddingScore[]> {
    this.assertVector(query);
    if (candidates.length === 0) {
      return [];
    }

    const queryLiteral = this.toVectorLiteral(query);
    const rows = await prisma.$queryRaw<SimilarityRow[]>`
      SELECT
        "trackId",
        (1 - ("vector" <=> ${queryLiteral}::vector))::double precision AS "score"
      FROM "TrackEmbedding"
      WHERE "trackId" IN (${Prisma.join(candidates)})
      ORDER BY "vector" <=> ${queryLiteral}::vector ASC
    `;

    return rows.map((row) => ({
      trackId: row.trackId,
      score: Number(row.score),
    }));
  }

  private assertVector(vector: number[]) {
    if (vector.length !== this.dimension) {
      throw new Error(`Embedding vector must have ${this.dimension} dimensions`);
    }
    if (vector.some((value) => !Number.isFinite(value))) {
      throw new Error("Embedding vector values must be finite numbers");
    }
  }

  private toVectorLiteral(vector: number[]) {
    return `[${vector.join(",")}]`;
  }

  private parseVector(value: string) {
    return value
      .replace(/^\[/, "")
      .replace(/\]$/, "")
      .split(",")
      .filter(Boolean)
      .map(Number);
  }
}
