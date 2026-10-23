import { Injectable, Logger } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AI_PROMOTIONAL_ELIGIBILITY_WHERE } from "../catalog/ai-disclosure.policy";
import {
  WITHDRAWABLE_RELEASE_STATUSES,
  classifyTrackAvailability,
  isPlayableAvailability,
} from "../catalog/track-availability";
import {
  getAgentSoundsCacheTtlMs,
  soundsForListener,
  tallyCatalogSounds,
  type CatalogSoundsAggregate,
  type ListenerSounds,
  type SoundsTrackRow,
} from "./agent_sounds";

const PAGE_SIZE = 2000;
/** Upper bound on scanned tracks, so one refresh can never run unbounded. */
const MAX_SCANNED_TRACKS = 200_000;

/**
 * Count the playable, promotion-eligible tracks per genre family.
 *
 * "Playable" is the catalog's own availability rule (`classifyTrackAvailability`:
 * ready/published release, clean content, a public rights route) plus a current
 * stem to stream. "Promotion-eligible" is `AI_PROMOTIONAL_ELIGIBILITY_WHERE`
 * (fully AI-generated tracks are excluded, ADR-BM-5), the same filter the AI DJ
 * retrieval and the discovery rails apply. `scope` narrows the catalog and is
 * for tests; production passes none.
 */
export async function computeCatalogSounds(
  scope: Prisma.TrackWhereInput = {},
  now: Date = new Date(),
): Promise<CatalogSoundsAggregate> {
  const rows: SoundsTrackRow[] = [];
  let cursor: string | undefined;
  let scanned = 0;
  while (scanned < MAX_SCANNED_TRACKS) {
    const page = await prisma.track.findMany({
      where: {
        ...AI_PROMOTIONAL_ELIGIBILITY_WHERE,
        contentStatus: "clean",
        release: { status: { in: [...WITHDRAWABLE_RELEASE_STATUSES] } },
        stems: { some: { isCurrent: true } },
        ...scope,
      },
      select: {
        id: true,
        explicit: true,
        contentStatus: true,
        rightsRoute: true,
        release: {
          select: {
            status: true,
            genre: true,
            rightsRoute: true,
            withdrawnAt: true,
            withdrawalReason: true,
          },
        },
        descriptor: { select: { families: true } },
      },
      orderBy: { id: "asc" },
      take: PAGE_SIZE,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (page.length === 0) break;
    for (const track of page) {
      if (!isPlayableAvailability(classifyTrackAvailability(track))) continue;
      rows.push({
        explicit: track.explicit,
        genre: track.release?.genre ?? null,
        descriptorFamilies: track.descriptor?.families ?? null,
      });
    }
    scanned += page.length;
    cursor = page[page.length - 1].id;
    if (page.length < PAGE_SIZE) break;
  }
  return tallyCatalogSounds(rows, now);
}

/**
 * One in-memory aggregate for the whole catalog, refreshed at most once per TTL
 * (`AGENT_SOUNDS_CACHE_TTL_MS`). Concurrent requests share one refresh; if a
 * refresh fails the last good aggregate keeps serving. Per-listener answers are
 * derived from it in memory, so a render never queries the catalog.
 */
@Injectable()
export class AgentSoundsService {
  private readonly logger = new Logger(AgentSoundsService.name);
  private cached: { aggregate: CatalogSoundsAggregate; expiresAt: number } | null = null;
  private inflight: Promise<CatalogSoundsAggregate> | null = null;

  async getAggregate(now: number = Date.now()): Promise<CatalogSoundsAggregate> {
    if (this.cached && this.cached.expiresAt > now) return this.cached.aggregate;
    if (!this.inflight) {
      this.inflight = computeCatalogSounds({}, new Date(now))
        .then((aggregate) => {
          this.cached = { aggregate, expiresAt: now + getAgentSoundsCacheTtlMs() };
          return aggregate;
        })
        .catch((error) => {
          if (!this.cached) throw error;
          this.logger.warn(
            `Sounds aggregate refresh failed; serving the previous one: ${error instanceof Error ? error.message : String(error)}`,
          );
          // Retry after a short pause instead of on every request.
          this.cached = { ...this.cached, expiresAt: now + 30_000 };
          return this.cached.aggregate;
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    return this.inflight;
  }

  async getForListener(options: {
    allowExplicit: boolean;
    genreWeights?: Readonly<Record<string, number>> | null;
  }): Promise<ListenerSounds> {
    return soundsForListener(await this.getAggregate(), options);
  }

  /** Drop the cached aggregate (tests, admin tooling). */
  invalidate(): void {
    this.cached = null;
  }
}
