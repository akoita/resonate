import { Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { TRACK_EMBEDDING_DIMENSION } from "./embedding.config";

export interface EmbeddingScore {
  trackId: string;
  score: number;
}

export interface EmbeddingContentState {
  model: string;
  contentHash: string;
}

export type EmbeddingNoteState = EmbeddingContentState;

export interface NearestOptions {
  /** Only vectors stored under this model are compared. */
  model: string;
  /** Clamped to 1..NEAREST_MAX_LIMIT. */
  limit?: number;
  excludeTrackIds?: string[];
}

export const NEAREST_MAX_LIMIT = 100;
const NEAREST_DEFAULT_LIMIT = 10;

interface EmbeddingRow {
  trackId: string;
  vector: string;
}

interface ScoreRow {
  trackId: string;
  score: number;
}

interface ContentStateRow {
  trackId: string;
  model: string;
  contentHash: string;
}

/**
 * Raw-SQL pgvector store for track embeddings (Prisma cannot express the
 * `vector` type). Every comparison is model-scoped so vectors from different
 * embedders never mix. Cosine distance is `<=>`; `score = 1 - distance`.
 */
@Injectable()
export class EmbeddingStore {
  private readonly dimension = TRACK_EMBEDDING_DIMENSION;

  async upsert(
    trackId: string,
    vector: number[],
    model: string,
    contentHash: string,
  ) {
    this.assertVector(vector);
    const literal = this.toVectorLiteral(vector);
    await prisma.$executeRaw`
      INSERT INTO "TrackEmbedding" ("trackId", "vector", "model", "contentHash", "updatedAt")
      VALUES (${trackId}, ${literal}::vector, ${model}, ${contentHash}, NOW())
      ON CONFLICT ("trackId") DO UPDATE
      SET "vector" = EXCLUDED."vector",
          "model" = EXCLUDED."model",
          "contentHash" = EXCLUDED."contentHash",
          "updatedAt" = NOW()
    `;
  }

  /** The stored vector for a track, optionally only when it was made by `model`. */
  async get(trackId: string, model?: string) {
    const rows = await prisma.$queryRaw<EmbeddingRow[]>`
      SELECT "trackId", "vector"::text AS "vector"
      FROM "TrackEmbedding"
      WHERE "trackId" = ${trackId}
        ${model === undefined ? Prisma.empty : Prisma.sql`AND "model" = ${model}`}
      LIMIT 1
    `;
    const row = rows[0];
    return row ? this.parseVector(row.vector) : null;
  }

  /** Model + content hash of the stored vectors for the given tracks. */
  async getContentStates(
    trackIds: string[],
  ): Promise<Map<string, EmbeddingContentState>> {
    if (trackIds.length === 0) return new Map();
    const rows = await prisma.$queryRaw<ContentStateRow[]>`
      SELECT "trackId", "model", "contentHash"
      FROM "TrackEmbedding"
      WHERE "trackId" IN (${Prisma.join(trackIds)})
    `;
    return new Map(
      rows.map((row) => [
        row.trackId,
        { model: row.model, contentHash: row.contentHash },
      ]),
    );
  }

  /** Mark vectors as freshly verified without rewriting them. */
  async touch(trackIds: string[]) {
    if (trackIds.length === 0) return;
    await prisma.$executeRaw`
      UPDATE "TrackEmbedding"
      SET "updatedAt" = NOW()
      WHERE "trackId" IN (${Prisma.join(trackIds)})
    `;
  }

  async similarity(
    query: number[],
    candidates: string[],
    model: string,
  ): Promise<EmbeddingScore[]> {
    this.assertVector(query);
    if (candidates.length === 0) {
      return [];
    }

    const queryLiteral = this.toVectorLiteral(query);
    const rows = await prisma.$queryRaw<ScoreRow[]>`
      SELECT
        "trackId",
        (1 - ("vector" <=> ${queryLiteral}::vector))::double precision AS "score"
      FROM "TrackEmbedding"
      WHERE "trackId" IN (${Prisma.join(candidates)})
        AND "model" = ${model}
      ORDER BY "vector" <=> ${queryLiteral}::vector ASC
    `;

    return rows.map((row) => ({
      trackId: row.trackId,
      score: Number(row.score),
    }));
  }

  /**
   * Nearest neighbours by cosine distance. `ORDER BY "vector" <=> $q LIMIT k`
   * is the shape that lets the planner use the HNSW index.
   */
  async nearest(
    query: number[],
    options: NearestOptions,
  ): Promise<EmbeddingScore[]> {
    this.assertVector(query);
    const limit = Math.min(
      NEAREST_MAX_LIMIT,
      Math.max(1, Math.floor(options.limit ?? NEAREST_DEFAULT_LIMIT)),
    );
    const exclude = options.excludeTrackIds?.filter(Boolean) ?? [];
    const queryLiteral = this.toVectorLiteral(query);
    // pgvector's HNSW scan yields at most `hnsw.ef_search` (default 40)
    // candidates before the model/exclude filters apply, so widen it with the
    // requested limit. `set_config(..., true)` is transaction-local.
    const efSearch = Math.min(1000, Math.max(40, limit * 4));
    const [, rows] = await prisma.$transaction([
      prisma.$queryRaw`SELECT set_config('hnsw.ef_search', ${String(efSearch)}, true)`,
      prisma.$queryRaw<ScoreRow[]>`
        SELECT
          "trackId",
          (1 - ("vector" <=> ${queryLiteral}::vector))::double precision AS "score"
        FROM "TrackEmbedding"
        WHERE "model" = ${options.model}
          ${exclude.length ? Prisma.sql`AND "trackId" NOT IN (${Prisma.join(exclude)})` : Prisma.empty}
        ORDER BY "vector" <=> ${queryLiteral}::vector ASC
        LIMIT ${limit}
      `,
    ]);
    return rows.map((row) => ({
      trackId: row.trackId,
      score: Number(row.score),
    }));
  }

  // ---------------------------------------------------------------------------
  // Listener taste-note vectors (#2006). The note text lives on the control row;
  // only the vector is stored here, and it cascades away with the control.
  // ---------------------------------------------------------------------------

  async upsertTasteNote(
    controlId: string,
    vector: number[],
    model: string,
    contentHash: string,
  ) {
    this.assertVector(vector);
    const literal = this.toVectorLiteral(vector);
    await prisma.$executeRaw`
      INSERT INTO "ListenerTasteNoteEmbedding"
        ("controlId", "vector", "model", "contentHash", "updatedAt")
      VALUES (${controlId}, ${literal}::vector, ${model}, ${contentHash}, NOW())
      ON CONFLICT ("controlId") DO UPDATE
      SET "vector" = EXCLUDED."vector",
          "model" = EXCLUDED."model",
          "contentHash" = EXCLUDED."contentHash",
          "updatedAt" = NOW()
    `;
  }

  /** Model + content hash of a note's stored vector, or null when it has none. */
  async getTasteNoteState(controlId: string): Promise<EmbeddingNoteState | null> {
    const rows = await prisma.$queryRaw<Array<{ model: string; contentHash: string }>>`
      SELECT "model", "contentHash"
      FROM "ListenerTasteNoteEmbedding"
      WHERE "controlId" = ${controlId}
      LIMIT 1
    `;
    return rows[0] ?? null;
  }

  /**
   * The newest stored note vectors for one listener under `model`. Only
   * `note` controls the listener still holds are reachable (the row cascades
   * with the control), so a removed note can never seed anything.
   */
  async listTasteNoteVectors(
    userId: string,
    model: string,
    limit: number,
  ): Promise<Array<{ controlId: string; vector: number[] }>> {
    const take = Math.min(10, Math.max(1, Math.floor(limit)));
    const rows = await prisma.$queryRaw<Array<{ controlId: string; vector: string }>>`
      SELECT e."controlId" AS "controlId", e."vector"::text AS "vector"
      FROM "ListenerTasteNoteEmbedding" e
      JOIN "ListenerTasteSignalControl" c ON c."id" = e."controlId"
      WHERE c."userId" = ${userId}
        AND c."signalType" = 'note'
        AND e."model" = ${model}
      ORDER BY c."createdAt" DESC, c."id" ASC
      LIMIT ${take}
    `;
    return rows.map((row) => ({
      controlId: row.controlId,
      vector: this.parseVector(row.vector),
    }));
  }

  private assertVector(vector: number[]) {
    if (vector.length !== this.dimension) {
      throw new Error(`Embedding vector must have ${this.dimension} dimensions`);
    }
    if (vector.some((value) => !Number.isFinite(value))) {
      throw new Error("Embedding vector values must be finite numbers");
    }
    if (vector.every((value) => value === 0)) {
      throw new Error("Embedding vector must not be all zeros");
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
