import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { AgentLearningService } from "../agents/agent_learning.service";
import {
  classifyTrackAvailability,
  isPlayableAvailability,
  WITHDRAWABLE_RELEASE_STATUSES,
} from "../catalog/track-availability";
import { DiscoveryPolicyContextService } from "../recommendations/discovery-policy-context.service";
import {
  DiscoveryRankingService,
  type DiscoveryCandidate,
  type DiscoveryRankingContext,
} from "../recommendations/discovery-ranking.service";
import { TasteMemoryService } from "../recommendations/taste_memory.service";
import { resolveCreditedArtistName } from "../shared/artist_attribution";
import type {
  CrateDto,
  CrateItemDto,
  CreateCrateResponse,
  GetCrateResponse,
} from "./crate.dto";
import {
  CRATE_MAX_COUNT,
  CRATE_MIN_COUNT,
  CRATE_REQUEST_MAX_TEXT_LENGTH,
  type CrateCandidateFacts,
  type CrateCoverage,
  type CrateFilters,
  type CrateRequestSource,
} from "./crate.types";
import { CrateEntitlementsService } from "./crate-entitlements";
import { candidateFactsFromRow, type CrateTrackRow } from "./crate_candidates";
import { sanitizeCrateFilters } from "./crate_filters";
import { orderCrateAsSetPath, transitionFacts } from "./crate_ordering";
import {
  CRATE_REQUEST_PARSER,
  filtersFromReferenceTrack,
  type CrateRequestParser,
} from "./crate_request_parser";
import {
  computeCoverage,
  failedFilters,
  isExcludedAsFullyAi,
  linePriceUsd,
  selectCrateLinesWithStats,
} from "./crate_selection";

/**
 * Crate Digger service (#1962, docs/rfc/taste-engine.md §5.1-5.2): turns a
 * DJ's text, a reference track or edited filters into one ordered, persisted
 * draft crate with honest coverage.
 *
 * Pipeline: bounded playable candidate pool -> drop fully AI recordings the
 * request does not allow -> keep candidates passing every filter -> rank them
 * with the shared ranker and the DJ's taste -> take the best lines that fit
 * (count, total budget) -> coverage over everything considered -> set-path
 * ordering. Listings and prices are FILTERS the DJ chose and are never ranking
 * inputs (ADR-TE-2 rule 6): `hasListing` reaches the ranker as data only.
 *
 * PRIVACY: the request text and the unparsed phrases are never stored, never
 * logged and never used as a title. `unparsed` exists in the response only.
 *
 * Business model: ADR-BM-6 Line 3 (marketplace take-rate, 10%), phase 2:
 * crates lead to quoted purchases (#1964). Building a crate is free for
 * everyone (crate-entitlements.ts) and no price or fee is charged here.
 */

/** Most catalog tracks one request considers; newest releases first. */
export const CRATE_CANDIDATE_POOL_LIMIT = 500;

/** Fixed codes for 400 responses; never echo the input. */
export const CRATE_REQUEST_ERROR_CODES = {
  exactlyOneSource: "exactly_one_source_required",
  textTooLong: "text_too_long",
  emptyText: "empty_text",
  invalidReferenceTrackId: "invalid_reference_track_id",
  invalidCount: "invalid_count",
  invalidFilters: "invalid_filters",
} as const;

/**
 * The service validates "exactly one of": the HTTP DTO makes every field
 * optional and class-validator cannot express that rule.
 */
export type CrateRequestInput = {
  text?: unknown;
  referenceTrackId?: unknown;
  filters?: unknown;
  count?: unknown;
};

function provided(value: unknown): boolean {
  return value !== undefined && value !== null;
}

function clampCount(count: number): number {
  return Math.min(CRATE_MAX_COUNT, Math.max(CRATE_MIN_COUNT, Math.round(count)));
}

/** One ranked or loaded line, before it becomes a DTO. */
type CrateLine = {
  row: CrateTrackRow;
  facts: CrateCandidateFacts;
  available: boolean;
  /** Ranker score (0 on GET, where the order is the stored position). */
  score: number;
  explanation?: string[];
};

/** Everything the crate pipeline reads about a track. */
function crateTrackSelect(now: Date) {
  return {
    id: true,
    title: true,
    artist: true,
    aiDisclosureLevel: true,
    contentStatus: true,
    rightsRoute: true,
    release: {
      select: {
        title: true,
        status: true,
        rightsRoute: true,
        withdrawnAt: true,
        withdrawalReason: true,
        genre: true,
        moods: true,
        artistId: true,
        primaryArtist: true,
        artist: { select: { displayName: true } },
      },
    },
    stems: {
      where: { isCurrent: true },
      select: {
        type: true,
        isCurrent: true,
        audioFeatures: true,
        pricing: {
          select: {
            basePlayPriceUsd: true,
            remixLicenseUsd: true,
            commercialLicenseUsd: true,
          },
        },
        listings: {
          where: { status: "active", expiresAt: { gt: now } },
          select: { licenseType: true, status: true, expiresAt: true },
        },
      },
    },
  } satisfies Prisma.TrackSelect;
}

@Injectable()
export class CratesService {
  private readonly logger = new Logger(CratesService.name);

  constructor(
    @Inject(CRATE_REQUEST_PARSER) private readonly parser: CrateRequestParser,
    private readonly ranking: DiscoveryRankingService,
    private readonly policyContext: DiscoveryPolicyContextService,
    private readonly entitlements: CrateEntitlementsService,
    // The DJ's taste. Both are optional: without them the crate ranks with an
    // empty-taste context, the same deterministic fallback as everywhere else.
    @Optional() private readonly learning?: AgentLearningService,
    @Optional() private readonly tasteMemory?: TasteMemoryService,
  ) {}

  // -------------------------------------------------------------------------
  // POST /crates/requests
  // -------------------------------------------------------------------------

  async createFromRequest(
    userId: string,
    input: CrateRequestInput,
  ): Promise<CreateCrateResponse> {
    const resolved = await this.resolveFilters(input);
    const { filters, source, referenceTrackId, parserStrategy, unparsed } = resolved;
    const now = new Date();

    const rows = await this.loadCandidateRows(now, referenceTrackId);
    const playable = rows.filter((row) =>
      isPlayableAvailability(classifyTrackAvailability(row)),
    );
    const verifiedHumanArtistIds = await this.loadVerifiedHumanArtistIds(
      playable.map((row) => row.release.artistId),
    );
    const considered = playable.map((row) => ({
      row,
      facts: candidateFactsFromRow(row, verifiedHumanArtistIds, now),
    }));

    // Fully AI recordings appear only when the request allows them; then keep
    // what passes every filter. Only these are ranked.
    const passing = considered.filter(
      ({ facts }) =>
        !isExcludedAsFullyAi(facts, filters) && failedFilters(facts, filters).length === 0,
    );
    const rankedPassing = await this.rankPassing(userId, passing);

    const selection = selectCrateLinesWithStats(rankedPassing, filters);
    const coverage: CrateCoverage = computeCoverage(
      considered.map(({ facts }) => facts),
      selection.lines.length,
      filters,
      selection.budgetSkipped,
    );
    const ordered = orderCrateAsSetPath(selection.lines);

    const crate = await prisma.$transaction(async (tx) => {
      const created = await tx.crate.create({
        data: {
          userId,
          title: null,
          filters: filters as unknown as Prisma.InputJsonObject,
          status: "draft",
        },
      });
      if (ordered.length > 0) {
        await tx.crateItem.createMany({
          data: ordered.map((line, position) => ({
            crateId: created.id,
            // Always the crate owner (denormalized for export and erasure).
            userId,
            trackId: line.facts.trackId,
            position,
          })),
        });
      }
      const request = await tx.crateRequest.create({
        data: {
          userId,
          crateId: created.id,
          source,
          referenceTrackId,
          filters: filters as unknown as Prisma.InputJsonObject,
          parserStrategy,
          unparsedCount: unparsed.length,
          requestedCount: coverage.requested,
          foundCount: coverage.found,
          unmetFilters: coverage.gaps.map((gap) => gap.filter),
        },
      });
      return { created, request };
    });

    return {
      crate: await this.toCrateDto(userId, crate.created, filters, ordered),
      request: {
        id: crate.request.id,
        source,
        parserStrategy,
        unparsed,
      },
      coverage,
    };
  }

  // -------------------------------------------------------------------------
  // GET /crates/:id
  // -------------------------------------------------------------------------

  async getCrate(userId: string, crateId: string): Promise<GetCrateResponse> {
    // Someone else's crate and an unknown id look identical: 404, never 403.
    const crate = await prisma.crate.findFirst({
      where: { id: crateId, userId },
      include: { items: { orderBy: { position: "asc" } } },
    });
    if (!crate) throw new NotFoundException("Crate not found");

    const now = new Date();
    const rows = await prisma.track.findMany({
      where: { id: { in: crate.items.map((item) => item.trackId) } },
      select: crateTrackSelect(now),
    });
    const rowById = new Map(rows.map((row) => [row.id, row as CrateTrackRow]));
    const verifiedHumanArtistIds = await this.loadVerifiedHumanArtistIds(
      rows.map((row) => row.release.artistId),
    );

    // Rebuilt from the current catalog. A line whose track is no longer
    // playable stays, marked unavailable, instead of silently disappearing.
    const lines: CrateLine[] = [];
    for (const item of crate.items) {
      const row = rowById.get(item.trackId);
      if (!row) continue;
      lines.push({
        row,
        facts: candidateFactsFromRow(row, verifiedHumanArtistIds, now),
        available: isPlayableAvailability(classifyTrackAvailability(row)),
        score: 0,
      });
    }
    const filters = sanitizeCrateFilters(crate.filters).filters;
    const lockedByTrack = new Map(crate.items.map((item) => [item.trackId, item.locked]));

    return {
      crate: await this.toCrateDto(userId, crate, filters, lines, lockedByTrack),
    };
  }

  // -------------------------------------------------------------------------
  // Request resolution
  // -------------------------------------------------------------------------

  private async resolveFilters(input: CrateRequestInput): Promise<{
    filters: CrateFilters;
    source: CrateRequestSource;
    referenceTrackId: string | null;
    parserStrategy: "deterministic" | "model-assisted";
    unparsed: string[];
  }> {
    const sources = [input.text, input.referenceTrackId, input.filters].filter(provided);
    if (sources.length !== 1) {
      throw new BadRequestException({
        code: CRATE_REQUEST_ERROR_CODES.exactlyOneSource,
        message: "Provide exactly one of text, referenceTrackId or filters",
      });
    }

    let count: number | undefined;
    if (provided(input.count)) {
      if (typeof input.count !== "number" || !Number.isFinite(input.count)) {
        throw new BadRequestException({
          code: CRATE_REQUEST_ERROR_CODES.invalidCount,
          message: "count must be a number",
        });
      }
      count = clampCount(input.count);
    }

    if (provided(input.text)) {
      if (typeof input.text !== "string" || input.text.trim().length === 0) {
        throw new BadRequestException({
          code: CRATE_REQUEST_ERROR_CODES.emptyText,
          message: "text must be a non-empty string",
        });
      }
      if (input.text.length > CRATE_REQUEST_MAX_TEXT_LENGTH) {
        throw new BadRequestException({
          code: CRATE_REQUEST_ERROR_CODES.textTooLong,
          message: `text must be at most ${CRATE_REQUEST_MAX_TEXT_LENGTH} characters`,
        });
      }
      const parsed = await this.parser.parse(input.text);
      return {
        filters: count === undefined ? parsed.filters : { ...parsed.filters, count },
        source: "text",
        referenceTrackId: null,
        parserStrategy: parsed.strategy,
        unparsed: parsed.unparsed,
      };
    }

    if (provided(input.referenceTrackId)) {
      if (typeof input.referenceTrackId !== "string" || input.referenceTrackId.trim() === "") {
        throw new BadRequestException({
          code: CRATE_REQUEST_ERROR_CODES.invalidReferenceTrackId,
          message: "referenceTrackId must be a non-empty string",
        });
      }
      const referenceTrackId = input.referenceTrackId.trim();
      const now = new Date();
      const row = (await prisma.track.findUnique({
        where: { id: referenceTrackId },
        select: crateTrackSelect(now),
      })) as CrateTrackRow | null;
      if (!row || !isPlayableAvailability(classifyTrackAvailability(row))) {
        throw new NotFoundException("Reference track not found");
      }
      const reference = candidateFactsFromRow(row, new Set(), now);
      return {
        filters: filtersFromReferenceTrack(
          {
            tempoBpm: reference.tempoBpm,
            camelot: reference.camelot,
            energy: reference.energy,
            genre: reference.genre,
          },
          count,
        ),
        source: "reference_track",
        referenceTrackId,
        parserStrategy: "deterministic",
        unparsed: [],
      };
    }

    // Edited filters: the contract is validated, never trusted.
    const sanitized = sanitizeCrateFilters(input.filters);
    if (sanitized.errors.length > 0) {
      throw new BadRequestException({
        code: CRATE_REQUEST_ERROR_CODES.invalidFilters,
        message: "Invalid crate filters",
        errors: sanitized.errors,
      });
    }
    return {
      filters: sanitized.filters,
      source: "filters",
      referenceTrackId: null,
      parserStrategy: "deterministic",
      unparsed: [],
    };
  }

  // -------------------------------------------------------------------------
  // Candidates, policy context and ranking
  // -------------------------------------------------------------------------

  /**
   * The bounded, deterministic candidate pool: newest release first, then track
   * id. Pre-filtered in SQL with the cheap availability conditions; the caller
   * still classifies each row in memory (rights routes, quarantine).
   */
  private async loadCandidateRows(
    now: Date,
    excludeTrackId: string | null,
  ): Promise<CrateTrackRow[]> {
    const rows = await prisma.track.findMany({
      where: {
        ...(excludeTrackId ? { id: { not: excludeTrackId } } : {}),
        contentStatus: "clean",
        release: {
          status: { in: [...WITHDRAWABLE_RELEASE_STATUSES] },
          withdrawnAt: null,
        },
      },
      orderBy: [{ release: { createdAt: "desc" } }, { id: "asc" }],
      take: CRATE_CANDIDATE_POOL_LIMIT,
      select: crateTrackSelect(now),
    });
    return rows as CrateTrackRow[];
  }

  /**
   * Verified-human artists among the candidates (the shared policy lookup).
   * The listener id is deliberately not passed: the crate does not need their
   * played-artist history, so that read is skipped.
   */
  private async loadVerifiedHumanArtistIds(artistIds: string[]): Promise<Set<string>> {
    const context = await this.policyContext.loadContext(undefined, artistIds);
    return context.verifiedHumanArtistIds;
  }

  /**
   * Ranks the filter-passing candidates with the shared ranker and the DJ's
   * taste. `hasListing` goes in as data only; price, listing and payment are
   * never ranking inputs (ADR-TE-2 rule 6).
   */
  private async rankPassing(
    userId: string,
    passing: Array<{ row: CrateTrackRow; facts: CrateCandidateFacts }>,
  ): Promise<CrateLine[]> {
    if (passing.length === 0) return [];
    const context = await this.rankingContext(userId);
    const byId = new Map(passing.map((entry) => [entry.facts.trackId, entry]));

    const candidates: DiscoveryCandidate[] = passing.map(({ row, facts }) => ({
      id: row.id,
      title: row.title,
      artist: row.artist,
      hasListing: facts.listedLicenseTypes.length > 0,
      artistId: row.release.artistId,
      aiDisclosureLevel: row.aiDisclosureLevel,
      release: {
        genre: row.release.genre,
        title: row.release.title,
        moods: row.release.moods,
        artistDisplayName: creditedArtistName(row),
      },
    }));

    const ranked = await this.ranking.rank(candidates, context);
    const lines: CrateLine[] = [];
    for (const entry of ranked) {
      const found = byId.get(entry.id);
      if (!found) continue;
      lines.push({
        row: found.row,
        facts: found.facts,
        available: true,
        score: entry.score,
        explanation: entry.explanation,
      });
    }
    return lines;
  }

  /**
   * The ranking context for this DJ: their learned genre weights and taste
   * policy (declared boosts, taste-memory reset), exactly as the AI DJ builds
   * it. No queries, no session intent, no recent tracks. If their taste cannot
   * be resolved the crate ranks with an empty-taste context; the reason is a
   * fixed string, never user data.
   */
  private async rankingContext(userId: string): Promise<DiscoveryRankingContext> {
    const context: DiscoveryRankingContext = {
      originalQueries: [],
      expandedQueries: [],
    };
    if (!this.learning) return context;
    try {
      const policy = await this.tasteMemory?.getPolicy(userId);
      const profile = await this.learning.resolveTasteProfile(userId, [], policy);
      return {
        ...context,
        learnedGenreWeights: profile.genreWeights,
        ...(policy ? { tastePolicy: policy } : {}),
      };
    } catch {
      this.logger.warn("Taste profile unavailable for crate ranking; using empty taste");
      return context;
    }
  }

  // -------------------------------------------------------------------------
  // DTO
  // -------------------------------------------------------------------------

  private async toCrateDto(
    userId: string,
    crate: { id: string; status: string; title: string | null; createdAt: Date; updatedAt: Date },
    filters: CrateFilters,
    lines: CrateLine[],
    lockedByTrack: ReadonlyMap<string, boolean> = new Map(),
  ): Promise<CrateDto> {
    const items: CrateItemDto[] = lines.map((line, position) => {
      const next = lines[position + 1];
      const { facts } = line;
      return {
        position,
        locked: lockedByTrack.get(facts.trackId) ?? false,
        trackId: facts.trackId,
        title: line.row.title,
        artistId: facts.artistId,
        artistName: creditedArtistName(line.row),
        available: line.available,
        tempoBpm: facts.tempoBpm,
        camelot: facts.camelot,
        energy: facts.energy,
        stemTypes: facts.stemTypes,
        listedLicenseTypes: facts.listedLicenseTypes,
        indicativePriceUsd: facts.indicativePriceUsd,
        linePriceUsd: linePriceUsd(facts, filters),
        verifiedHuman: facts.verifiedHuman,
        aiDisclosureLevel: facts.aiDisclosureLevel,
        ...(line.explanation ? { explanation: line.explanation } : {}),
        transitionToNext: next ? transitionFacts(facts, next.facts) : null,
      };
    });

    return {
      id: crate.id,
      status: crate.status,
      title: crate.title,
      filters,
      createdAt: crate.createdAt.toISOString(),
      updatedAt: crate.updatedAt.toISOString(),
      entitlements: await this.entitlements.forCrate(userId),
      items,
    };
  }
}

/** The credited artist (#1492), not the uploader account label. */
function creditedArtistName(row: CrateTrackRow): string | null {
  return resolveCreditedArtistName({
    trackArtist: row.artist,
    primaryArtist: row.release.primaryArtist,
    accountDisplayName: row.release.artist?.displayName ?? null,
  });
}
