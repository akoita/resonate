import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
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
import {
  CRATE_TITLE_MAX_LENGTH,
  type CrateDto,
  type CrateItemDto,
  type CrateItemStemDto,
  type CrateWatchDto,
  type CreateCrateResponse,
  type GetCrateResponse,
  type ListCratesResponse,
  type SwapCrateItemResponse,
  type UpdateCrateDto,
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
import { canCreateCrate, CrateEntitlementsService } from "./crate-entitlements";
import { candidateFactsFromRow, creditedArtistName, type CrateTrackRow } from "./crate_candidates";
import { sanitizeCrateFilters } from "./crate_filters";
import { crateTrackSelect } from "./crate_track_select";
import {
  CRATE_WATCH_ERROR_CODES,
  CRATE_WATCH_RECENT_MATCHES_LIMIT,
  isWatching,
  monthBounds,
  monthKey,
  parseWatchRequest,
  watchExpiresAt,
} from "./crate_watch";
import { CrateQuoteService } from "./crate_quote.service";
import { crateLicenseOptions } from "./crate_license_rights";
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
  invalidItems: "invalid_items",
  proRequired: "pro_required",
  lineLocked: "line_locked",
  lineChanged: "line_changed",
  lineExists: "line_exists",
  crateFull: "crate_full",
  trackNotFound: "track_not_found",
} as const;

/** Most crates `GET /crates` returns. */
export const CRATE_LIST_LIMIT = 50;

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

/** A playable candidate with its facts, before the filters run. */
type ConsideredCandidate = { row: CrateTrackRow; facts: CrateCandidateFacts };

/** Stem types that are not a usable stem for a DJ. */
const NON_STEM_TYPES = new Set(["original", "master"]);

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
    // The crate's latest quote (#1964); without it `latestQuote` is null.
    @Optional() private readonly quotes?: CrateQuoteService,
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

    const considered = await this.loadConsidered(now, referenceTrackId ? [referenceTrackId] : []);
    const passing = this.passingFilters(considered, filters);
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

    const lines = await this.loadCrateLines(crate.items.map((item) => item.trackId), new Date());
    const filters = sanitizeCrateFilters(crate.filters).filters;
    const lockedByTrack = new Map(crate.items.map((item) => [item.trackId, item.locked]));

    return {
      crate: await this.toCrateDto(userId, crate, filters, lines, lockedByTrack),
      latestQuote: (await this.quotes?.latestQuote(userId, crateId)) ?? null,
    };
  }

  /**
   * The lines of a stored crate in `trackIds` order, rebuilt from the current
   * catalog. A line whose track is no longer playable stays, marked
   * unavailable, instead of silently disappearing.
   */
  private async loadCrateLines(trackIds: string[], now: Date): Promise<CrateLine[]> {
    const rows = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      select: crateTrackSelect(now),
    });
    const rowById = new Map(rows.map((row) => [row.id, row as CrateTrackRow]));
    const verifiedHumanArtistIds = await this.loadVerifiedHumanArtistIds(
      rows.map((row) => row.release.artistId),
    );

    const lines: CrateLine[] = [];
    for (const trackId of trackIds) {
      const row = rowById.get(trackId);
      if (!row) continue;
      lines.push({
        row,
        facts: candidateFactsFromRow(row, verifiedHumanArtistIds, now),
        available: isPlayableAvailability(classifyTrackAvailability(row)),
        score: 0,
      });
    }
    return lines;
  }

  // -------------------------------------------------------------------------
  // GET /crates
  // -------------------------------------------------------------------------

  /** The caller's own crates, most recently updated first. */
  async listCrates(userId: string): Promise<ListCratesResponse> {
    const crates = await prisma.crate.findMany({
      where: { userId },
      orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
      take: CRATE_LIST_LIMIT,
      select: {
        id: true,
        title: true,
        status: true,
        createdAt: true,
        updatedAt: true,
        _count: { select: { items: true } },
      },
    });
    return {
      crates: crates.map((crate) => ({
        id: crate.id,
        title: crate.title,
        status: crate.status,
        itemCount: crate._count.items,
        createdAt: crate.createdAt.toISOString(),
        updatedAt: crate.updatedAt.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------------------
  // PATCH /crates/:id
  // -------------------------------------------------------------------------

  /**
   * Edits the caller's crate: title, draft/saved status, and the lines (order,
   * removal, lock). `items` is the full new order, applied in one transaction.
   * Never deletes or hides anything because of an entitlement.
   */
  async updateCrate(
    userId: string,
    crateId: string,
    input: UpdateCrateDto,
  ): Promise<GetCrateResponse> {
    const title = normalizeTitle(input.title);
    const requested = input.items ?? undefined;

    // Watching (#1967): validated before anything is read. Turning it on needs
    // the `watch` entitlement (before any lookup, like export); turning it off
    // is always allowed and never asks the resolver.
    let watch: { mode: "off" | "notify"; expiresInDays: number } | undefined;
    if (input.watch !== undefined && input.watch !== null) {
      const parsed = parseWatchRequest(input.watch);
      if (!parsed.ok) {
        throw new BadRequestException({
          code: parsed.code,
          message:
            parsed.code === CRATE_WATCH_ERROR_CODES.modeUnavailable
              ? "This watch mode is not available yet"
              : "watch must be { mode: \"off\" | \"notify\", expiresInDays?: 1-365 }",
        });
      }
      watch = { mode: parsed.mode, expiresInDays: parsed.expiresInDays };
      if (watch.mode === "notify") {
        const decision = await this.entitlements.watch(userId);
        if (!decision.allowed) {
          throw new ForbiddenException({
            code: CRATE_REQUEST_ERROR_CODES.proRequired,
            message: "Watching a crate needs Crate Digger Pro",
          });
        }
      }
    }

    const now = new Date();

    await prisma.$transaction(async (tx) => {
      // Someone else's crate and an unknown id look identical: 404, never 403.
      const crate = await tx.crate.findFirst({
        where: { id: crateId, userId },
        include: { items: true },
      });
      if (!crate) throw new NotFoundException("Crate not found");

      if (requested !== undefined) {
        const current = new Set(crate.items.map((item) => item.trackId));
        const seen = new Set<string>();
        for (const entry of requested) {
          if (
            !entry
            || typeof entry.trackId !== "string"
            || !current.has(entry.trackId)
            || seen.has(entry.trackId)
          ) {
            throw new BadRequestException({
              code: CRATE_REQUEST_ERROR_CODES.invalidItems,
              message: "items must list current lines of the crate, each at most once",
            });
          }
          seen.add(entry.trackId);
        }
      }

      if (input.status === "saved" && crate.status !== "saved") {
        const existingCrates = await tx.crate.count({ where: { userId, status: "saved" } });
        const decision = canCreateCrate({
          existingCrates,
          pro: await this.entitlements.pro(userId),
        });
        if (!decision.allowed) {
          throw new ForbiddenException({
            code: CRATE_REQUEST_ERROR_CODES.proRequired,
            message: "Saving more crates needs Crate Digger Pro",
          });
        }
      }

      // Only a saved crate can watch; the status this same request sets counts.
      if (watch?.mode === "notify" && (input.status ?? crate.status) !== "saved") {
        throw new ConflictException({
          code: CRATE_WATCH_ERROR_CODES.crateNotSaved,
          message: "Save the crate to watch it",
        });
      }

      if (requested !== undefined) {
        const lockedByTrack = new Map(crate.items.map((item) => [item.trackId, item.locked]));
        await tx.crateItem.deleteMany({
          where: { crateId, trackId: { notIn: requested.map((entry) => entry.trackId) } },
        });
        // Positions are not unique, so rewriting them one by one cannot clash.
        for (const [position, entry] of requested.entries()) {
          await tx.crateItem.update({
            where: { crateId_trackId: { crateId, trackId: entry.trackId } },
            data: { position, locked: entry.locked ?? lockedByTrack.get(entry.trackId) ?? false },
          });
        }
      }

      await tx.crate.update({
        where: { id: crateId },
        data: {
          ...(title !== undefined ? { title } : {}),
          ...(input.status ? { status: input.status } : {}),
          ...(watch?.mode === "notify"
            ? { watchMode: "notify", watchExpiresAt: watchExpiresAt(now, watch.expiresInDays) }
            : {}),
          ...(watch?.mode === "off" ? { watchMode: "off", watchExpiresAt: null } : {}),
          // Items live in another table; bump the crate so lists sort by edits.
          updatedAt: now,
        },
      });
    });

    return this.getCrate(userId, crateId);
  }

  // -------------------------------------------------------------------------
  // POST /crates/:id/items
  // -------------------------------------------------------------------------

  /**
   * Appends one track to the end of the caller's crate (#2032), e.g. from a
   * stem listing. The line is unlocked and owned by the crate owner. 404 for an
   * unknown or foreign crate and for a track that cannot be a crate line (it
   * does not exist or is not publicly playable); 409 `line_exists` when the
   * track is already a line and 409 `crate_full` at CRATE_MAX_COUNT lines.
   */
  async addItem(userId: string, crateId: string, trackId: string): Promise<GetCrateResponse> {
    const now = new Date();

    try {
      await prisma.$transaction(async (tx) => {
        // Someone else's crate and an unknown id look identical: 404, never 403.
        const crate = await tx.crate.findFirst({
          where: { id: crateId, userId },
          include: { items: true },
        });
        if (!crate) throw new NotFoundException("Crate not found");

        if (crate.items.some((item) => item.trackId === trackId)) {
          throw new ConflictException({
            code: CRATE_REQUEST_ERROR_CODES.lineExists,
            message: "The track is already in the crate",
          });
        }
        if (crate.items.length >= CRATE_MAX_COUNT) {
          throw new ConflictException({
            code: CRATE_REQUEST_ERROR_CODES.crateFull,
            message: `A crate holds at most ${CRATE_MAX_COUNT} tracks`,
          });
        }

        // Resolved like every stored line; a track that is gone or not publicly
        // playable is not something a DJ can add.
        const [line] = await this.loadCrateLines([trackId], now);
        if (!line || !line.available) {
          throw new NotFoundException({
            code: CRATE_REQUEST_ERROR_CODES.trackNotFound,
            message: "Track not available for crates",
          });
        }

        const position =
          crate.items.length === 0 ? 0 : Math.max(...crate.items.map((item) => item.position)) + 1;
        await tx.crateItem.create({
          data: {
            crateId,
            // Always the crate owner (denormalized for export and erasure).
            userId,
            trackId,
            position,
            locked: false,
          },
        });
        // Items live in another table; bump the crate so lists sort by edits.
        await tx.crate.update({ where: { id: crateId }, data: { updatedAt: now } });
      });
    } catch (error) {
      // The same track was added concurrently.
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: CRATE_REQUEST_ERROR_CODES.lineExists,
          message: "The track is already in the crate",
        });
      }
      throw error;
    }

    return this.getCrate(userId, crateId);
  }

  // -------------------------------------------------------------------------
  // POST /crates/:id/items/:trackId/swap
  // -------------------------------------------------------------------------

  /**
   * Replaces one unlocked line with the best-ranked candidate that passes the
   * crate's stored filters, is not already in the crate and keeps the crate
   * within `maxTotalUsd`. The line keeps its position. When nothing fits the
   * crate is unchanged and `swapped` is false.
   */
  async swapItem(
    userId: string,
    crateId: string,
    trackId: string,
  ): Promise<SwapCrateItemResponse> {
    const crate = await prisma.crate.findFirst({
      where: { id: crateId, userId },
      include: { items: { orderBy: { position: "asc" } } },
    });
    if (!crate) throw new NotFoundException("Crate not found");
    const item = crate.items.find((entry) => entry.trackId === trackId);
    if (!item) throw new NotFoundException("Crate line not found");
    if (item.locked) {
      throw new ConflictException({
        code: CRATE_REQUEST_ERROR_CODES.lineLocked,
        message: "The line is locked; unlock it to swap",
      });
    }

    const filters = sanitizeCrateFilters(crate.filters).filters;
    const now = new Date();

    // Whole cents, so a long sum never drifts past the budget. A remaining line
    // with no known price adds nothing: it was already accepted into the crate.
    let othersCents = 0;
    if (filters.maxTotalUsd !== null) {
      const lines = await this.loadCrateLines(
        crate.items.filter((entry) => entry.id !== item.id).map((entry) => entry.trackId),
        now,
      );
      for (const line of lines) {
        const price = linePriceUsd(line.facts, filters);
        if (price !== null) othersCents += Math.round(price * 100);
      }
    }
    const budgetCents =
      filters.maxTotalUsd === null ? null : Math.round(filters.maxTotalUsd * 100);

    const considered = await this.loadConsidered(
      now,
      crate.items.map((entry) => entry.trackId),
    );
    const ranked = await this.rankPassing(userId, this.passingFilters(considered, filters));
    const replacement = ranked.find((line) => {
      if (budgetCents === null) return true;
      const price = linePriceUsd(line.facts, filters);
      return price !== null && othersCents + Math.round(price * 100) <= budgetCents;
    });

    if (replacement) {
      try {
        await prisma.$transaction(async (tx) => {
          const updated = await tx.crateItem.updateMany({
            where: { id: item.id, crateId, trackId, locked: false },
            data: { trackId: replacement.facts.trackId, locked: false, addedAt: new Date() },
          });
          if (updated.count !== 1) throw new SwapRaceError();
          await tx.crate.update({ where: { id: crateId }, data: { updatedAt: new Date() } });
        });
      } catch (error) {
        // The line changed under us, or the replacement was added concurrently.
        if (error instanceof SwapRaceError || isUniqueViolation(error)) {
          throw new ConflictException({
            code: CRATE_REQUEST_ERROR_CODES.lineChanged,
            message: "The crate changed; reload it and try again",
          });
        }
        throw error;
      }
    }

    return { ...(await this.getCrate(userId, crateId)), swapped: replacement !== undefined };
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
    excludeTrackIds: readonly string[],
  ): Promise<CrateTrackRow[]> {
    const rows = await prisma.track.findMany({
      where: {
        ...(excludeTrackIds.length > 0 ? { id: { notIn: [...excludeTrackIds] } } : {}),
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
   * The playable candidates (never `excludeTrackIds`) with their facts. Shared
   * by creating a crate and swapping a line.
   */
  private async loadConsidered(
    now: Date,
    excludeTrackIds: readonly string[],
  ): Promise<ConsideredCandidate[]> {
    const rows = await this.loadCandidateRows(now, excludeTrackIds);
    const playable = rows.filter((row) =>
      isPlayableAvailability(classifyTrackAvailability(row)),
    );
    const verifiedHumanArtistIds = await this.loadVerifiedHumanArtistIds(
      playable.map((row) => row.release.artistId),
    );
    return playable.map((row) => ({
      row,
      facts: candidateFactsFromRow(row, verifiedHumanArtistIds, now),
    }));
  }

  /**
   * Fully AI recordings appear only when the request allows them; then keep
   * what passes every filter. Only these are ranked.
   */
  private passingFilters(
    considered: ConsideredCandidate[],
    filters: CrateFilters,
  ): ConsideredCandidate[] {
    return considered.filter(
      ({ facts }) =>
        !isExcludedAsFullyAi(facts, filters) && failedFilters(facts, filters).length === 0,
    );
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

  /**
   * Rounded mean quality score per stem, in one batched query. A stem with no
   * rating is absent.
   */
  private async loadStemQualityScores(stemIds: string[]): Promise<Map<string, number>> {
    const scores = new Map<string, number>();
    if (stemIds.length === 0) return scores;
    const groups = await prisma.stemQualityRating.groupBy({
      by: ["stemId"],
      where: { stemId: { in: [...new Set(stemIds)] } },
      _avg: { score: true },
    });
    for (const group of groups) {
      if (group._avg.score !== null) scores.set(group.stemId, Math.round(group._avg.score));
    }
    return scores;
  }

  /**
   * The crate's watch state (#1967): what is in effect now, this UTC month's
   * counts, and the newest matches that are still publicly playable. Read on
   * demand; there is no scheduled summary. Counts every match, listed or not.
   */
  private async loadWatch(crate: {
    id: string;
    status: string;
    watchMode: string;
    watchExpiresAt: Date | null;
  }): Promise<CrateWatchDto> {
    const now = new Date();
    const { start, end } = monthBounds(now);
    const inMonth = { crateId: crate.id, matchedAt: { gte: start, lt: end } };
    const [matches, notified, recent] = await Promise.all([
      prisma.crateWatchMatch.count({ where: inMonth }),
      prisma.crateWatchMatch.count({ where: { ...inMonth, notifiedAt: { not: null } } }),
      prisma.crateWatchMatch.findMany({
        where: { crateId: crate.id },
        orderBy: [{ matchedAt: "desc" }, { id: "asc" }],
        // More than the limit: matches of tracks that are no longer playable
        // are dropped below and must not leave the list short.
        take: CRATE_WATCH_RECENT_MATCHES_LIMIT * 5,
        select: { trackId: true, matchedAt: true },
      }),
    ]);

    let recentMatches: CrateWatchDto["recentMatches"] = [];
    if (recent.length > 0) {
      const rows = await prisma.track.findMany({
        where: { id: { in: recent.map((match) => match.trackId) } },
        select: crateTrackSelect(now),
      });
      const rowById = new Map(rows.map((row) => [row.id, row as CrateTrackRow]));
      recentMatches = recent
        .flatMap((match) => {
          const row = rowById.get(match.trackId);
          if (!row || !isPlayableAvailability(classifyTrackAvailability(row))) return [];
          return [
            {
              trackId: row.id,
              releaseId: row.releaseId ?? null,
              title: row.title,
              artistName: creditedArtistName(row),
              matchedAt: match.matchedAt.toISOString(),
            },
          ];
        })
        .slice(0, CRATE_WATCH_RECENT_MATCHES_LIMIT);
    }

    // A draft crate and a watch that has run out are not watching.
    const watching = crate.status === "saved" && isWatching(crate, now);
    return {
      mode: watching ? "notify" : "off",
      expiresAt: crate.watchMode === "notify" ? (crate.watchExpiresAt?.toISOString() ?? null) : null,
      summary: { month: monthKey(now), matches, notified },
      recentMatches,
    };
  }

  private async toCrateDto(
    userId: string,
    crate: {
      id: string;
      status: string;
      title: string | null;
      createdAt: Date;
      updatedAt: Date;
      watchMode: string;
      watchExpiresAt: Date | null;
    },
    filters: CrateFilters,
    lines: CrateLine[],
    lockedByTrack: ReadonlyMap<string, boolean> = new Map(),
  ): Promise<CrateDto> {
    const scores = await this.loadStemQualityScores(
      lines.flatMap((line) => lineStems(line.row).map((stem) => stem.id)),
    );
    const items: CrateItemDto[] = lines.map((line, position) => {
      const next = lines[position + 1];
      const { facts } = line;
      const original = line.row.stems.find(
        (stem) => stem.isCurrent && stem.type.toLowerCase() === "original" && stem.id,
      );
      const stems: CrateItemStemDto[] = lineStems(line.row).map((stem) => ({
        type: stem.type,
        qualityScore: scores.get(stem.id) ?? null,
      }));
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
        originalStemId: original?.id ?? null,
        stems,
        licenseOptions: crateLicenseOptions(facts),
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
      watch: await this.loadWatch(crate),
      items,
    };
  }
}

/** Current non-original, non-master stems with an id, sorted by type then id. */
function lineStems(row: CrateTrackRow): Array<{ id: string; type: string }> {
  const stems: Array<{ id: string; type: string }> = [];
  for (const stem of row.stems) {
    const type = stem.type.toLowerCase();
    if (!stem.isCurrent || !stem.id || NON_STEM_TYPES.has(type)) continue;
    stems.push({ id: stem.id, type });
  }
  return stems.sort((a, b) => a.type.localeCompare(b.type) || a.id.localeCompare(b.id));
}

/** Trimmed title; empty or null clears it; undefined leaves it unchanged. */
function normalizeTitle(title: string | null | undefined): string | null | undefined {
  if (title === undefined) return undefined;
  if (title === null) return null;
  const trimmed = title.trim();
  if (trimmed.length > CRATE_TITLE_MAX_LENGTH) {
    throw new BadRequestException({ code: "invalid_title", message: "title is too long" });
  }
  return trimmed === "" ? null : trimmed;
}

class SwapRaceError extends Error {}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object"
    && error !== null
    && (error as { code?: unknown }).code === "P2002"
  );
}
