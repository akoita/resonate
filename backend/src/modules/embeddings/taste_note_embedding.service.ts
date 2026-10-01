import { createHash } from "crypto";
import { Injectable, Logger } from "@nestjs/common";
import { EmbeddingService } from "./embedding.service";
import { EmbeddingStore } from "./embedding.store";
import { SimilarTrack, TrackEmbeddingService } from "./track_embedding.service";

/** Most written notes that steer one Home request. */
export const NOTE_SEED_LIMIT = 2;

/**
 * Embeddings of a listener's written taste notes (#2006, ADR-TE-5): a confirmed
 * `note` control such as "more live instruments" is embedded once, as a
 * retrieval query, and its vector then seeds a nearest-neighbour candidate
 * source on Home.
 *
 * Privacy: the note text is the listener's own words. It is passed to the
 * embedding provider and nowhere else: never logged, never published, never
 * stored outside the control row it already lives on. Only the vector, the
 * model id and a hash are stored here, and the row cascades away with the
 * control.
 *
 * Embedding is best-effort and metered, so it happens only when a taste edit is
 * applied (`embedNote`) and never from Home. With the provider disabled no
 * vector is written and notes keep having no ranking effect.
 */
@Injectable()
export class TasteNoteEmbeddingService {
  private readonly logger = new Logger(TasteNoteEmbeddingService.name);

  constructor(
    private readonly embeddingService: EmbeddingService,
    private readonly embeddingStore: EmbeddingStore,
    private readonly trackEmbeddings: TrackEmbeddingService,
  ) {}

  isEnabled(): boolean {
    return this.embeddingService.isEnabled();
  }

  /**
   * Embed and store a note's vector. Returns true when a vector is stored and
   * current, false when embeddings are off, the provider failed, or storage
   * failed. Never throws and never logs the text.
   */
  async embedNote(controlId: string, text: string): Promise<boolean> {
    try {
      const model = this.embeddingService.modelId;
      if (!model || !text.trim()) return false;
      const contentHash = noteContentHash(text, model);
      const state = await this.embeddingStore.getTasteNoteState(controlId);
      if (state && state.model === model && state.contentHash === contentHash) {
        return true;
      }
      const vector = await this.embeddingService.embedQuery(text);
      if (!vector) return false;
      await this.embeddingStore.upsertTasteNote(controlId, vector, model, contentHash);
      return true;
    } catch (error) {
      // The message is about storage or transport, never the note text.
      this.logger.warn(
        `Taste note embedding failed for control ${controlId}: ${error instanceof Error ? error.name : "error"}`,
      );
      return false;
    }
  }

  /**
   * Publicly listable tracks nearest to each of the listener's newest written
   * notes that have a current-model vector. Stored vectors only: no model call.
   * Each note contributes its own list, in note order.
   */
  async notesNeighbours(
    userId: string,
    options: { perNoteLimit?: number; allowExplicit?: boolean } = {},
  ): Promise<SimilarTrack[][]> {
    const model = this.embeddingService.modelId;
    if (!model) return [];
    const notes = await this.embeddingStore.listTasteNoteVectors(
      userId,
      model,
      NOTE_SEED_LIMIT,
    );
    return Promise.all(
      notes.map((note) =>
        this.trackEmbeddings.neighboursOfVector(note.vector, {
          limit: options.perNoteLimit ?? 10,
          allowExplicit: options.allowExplicit,
        }),
      ),
    );
  }
}

/** Change-detection hash: the same text under the same model needs no re-embed. */
export function noteContentHash(text: string, model: string): string {
  return createHash("sha256").update(`${model}\n${text.trim()}`).digest("hex");
}
