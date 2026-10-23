import { Inject, Injectable, OnModuleDestroy, OnModuleInit, Optional } from "@nestjs/common";
import { Subscription } from "rxjs";
import { prisma } from "../../db/prisma";
import type { CatalogReleaseReadyEvent } from "../../events/event_types";
import { EventBus } from "../shared/event_bus";
import {
  emptyTagResult,
  ModelCallBudget,
  structuredDescriptorLogger,
  TrackDescriptorTagger,
  type TagTracksResult,
} from "./track_descriptor_tagger";

/** Optional override of the tagger (tests inject one with a fake model client). */
export const TRACK_DESCRIPTOR_TAGGER = "TRACK_DESCRIPTOR_TAGGER";

const ENSURE_TRACKS_MAX_IDS = 200;

/**
 * Track descriptors on ingest (#2240). Subscribes to `catalog.release_ready`
 * and tags the release's tracks without blocking the upload: the handler is
 * fire-and-forget and every failure is logged and swallowed, so a tagging
 * problem can never fail or delay an upload.
 *
 * `ensureTracks` is also awaited by track embedding before it builds a
 * track's text, so a new release is embedded once, with its descriptor.
 * Concurrent calls for the same track share one in-flight promise, so the two
 * triggers never double-spend a model call.
 *
 * It never runs on the AI DJ pick path: that path only READS stored
 * descriptors.
 */
@Injectable()
export class TrackDescriptorService implements OnModuleInit, OnModuleDestroy {
  private readonly tagger: TrackDescriptorTagger;
  private readonly budget: ModelCallBudget;
  private readonly inFlight = new Map<string, Promise<void>>();
  private subscriptions: Subscription[] = [];

  constructor(
    @Optional() private readonly eventBus?: EventBus,
    @Optional() @Inject(TRACK_DESCRIPTOR_TAGGER) tagger?: TrackDescriptorTagger,
  ) {
    this.tagger = tagger ?? new TrackDescriptorTagger();
    this.budget = this.tagger.dailyBudget();
  }

  onModuleInit() {
    if (!this.eventBus) return;
    this.subscriptions.push(
      this.eventBus.subscribe<CatalogReleaseReadyEvent>("catalog.release_ready", (event) => {
        void this.ensureRelease(event.releaseId);
      }),
    );
  }

  onModuleDestroy() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.subscriptions = [];
  }

  /** Tags every track of a release. Never throws. */
  async ensureRelease(releaseId: string): Promise<TagTracksResult> {
    try {
      const tracks = await prisma.track.findMany({
        where: { releaseId },
        select: { id: true },
      });
      return await this.ensureTracks(tracks.map((track) => track.id));
    } catch (error) {
      this.logFailure(error);
      return emptyTagResult(this.tagger.config);
    }
  }

  /**
   * Tags the given tracks (eligible ones, hash-changed ones) and writes the
   * descriptors. Never throws; a track already being tagged is awaited, not
   * tagged twice.
   */
  async ensureTracks(trackIds: string[]): Promise<TagTracksResult> {
    const ids = [...new Set(trackIds.filter(Boolean))].slice(0, ENSURE_TRACKS_MAX_IDS);
    const waiting = ids.map((id) => this.inFlight.get(id)).filter((p): p is Promise<void> => !!p);
    const mine = ids.filter((id) => !this.inFlight.has(id));
    let result = emptyTagResult(this.tagger.config);
    if (mine.length > 0) {
      const work = this.tagger
        .tagTracks(mine, { apply: true, budget: this.budget })
        .then((tagged) => {
          result = tagged;
        })
        .catch((error) => this.logFailure(error))
        .then(() => undefined);
      for (const id of mine) this.inFlight.set(id, work);
      await work.finally(() => {
        for (const id of mine) this.inFlight.delete(id);
      });
    }
    await Promise.allSettled(waiting);
    return result;
  }

  private logFailure(error: unknown) {
    structuredDescriptorLogger.warn(
      "catalog.track_descriptor.ingest_failed",
      "Track descriptor tagging failed; the upload is unaffected",
      { error: error instanceof Error ? error.name : "unknown" },
    );
  }
}
