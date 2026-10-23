import type { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { writeStructuredLog } from "../shared/structured_logging";
import {
  createGoogleTrackDescriptorModelClient,
  requestModelDescriptor,
  TrackDescriptorModelError,
  trackDescriptorConfig,
  type TrackDescriptorConfig,
  type TrackDescriptorModelClient,
} from "./model_track_descriptor";
import {
  buildDescriptorInput,
  deterministicDescriptor,
  descriptorContentHash,
  mergeModelDescriptor,
  TRACK_DESCRIPTOR_VERSION,
  type TrackDescriptorInput,
  type TrackDescriptorSource,
  type TrackDescriptorStrategy,
  type TrackDescriptorValue,
} from "./track_descriptor";

/**
 * Computes and stores track descriptors (#2240). Plain class (no Nest) so the
 * backfill script and the ingest service share one implementation.
 *
 * Cost contract:
 *  - a track is tagged only when its content hash differs from the stored one
 *    (or it has no descriptor): repeated runs and repeated events cost nothing;
 *  - at most one model call per tagged track, only under `model-assisted`, only
 *    inside the call budget, and never on a dry run;
 *  - a model that was asked and failed falls back to the deterministic
 *    descriptor, stored under the DETERMINISTIC hash, so a later run (or a new
 *    key) retries it;
 *  - a track whose model descriptor is younger than `MODEL_RETAG_COOLDOWN_MS`
 *    keeps it even if its inputs changed, so repeated metadata edits cannot
 *    drive unbounded model calls;
 *  - an `artist` descriptor (corrections, #2292) is never overwritten.
 *
 * It writes `TrackDescriptor` rows and nothing else: no track, release or
 * disclosure column is ever updated here.
 */

export const MODEL_RETAG_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const DEFAULT_PAGE_SIZE = 200;

export interface TrackDescriptorLogger {
  warn(event: string, message: string, fields?: Record<string, unknown>): void;
  info(event: string, message: string, fields?: Record<string, unknown>): void;
}

export const structuredDescriptorLogger: TrackDescriptorLogger = {
  warn: (event, message, fields = {}) =>
    writeStructuredLog({ level: "warn", event, message, ...fields }),
  info: (event, message, fields = {}) =>
    writeStructuredLog({ level: "info", event, message, ...fields }),
};

/**
 * A cap on model calls: per backfill run (`window: "run"`) or per UTC day for
 * on-ingest tagging (`window: "day"`). Tripping it is logged once per window as
 * `catalog.track_descriptor.budget_exceeded` (the alert hook); over budget the
 * deterministic descriptor is used.
 */
export class ModelCallBudget {
  private used = 0;
  private windowKey: string;
  private tripped = false;

  constructor(
    readonly limit: number,
    private readonly window: "run" | "day",
    private readonly now: () => Date = () => new Date(),
    private readonly logger: TrackDescriptorLogger = structuredDescriptorLogger,
  ) {
    this.windowKey = this.keyFor(now());
  }

  private keyFor(date: Date): string {
    return this.window === "day" ? date.toISOString().slice(0, 10) : "run";
  }

  /** Takes one call if the budget allows it. */
  tryTake(): boolean {
    const key = this.keyFor(this.now());
    if (key !== this.windowKey) {
      this.windowKey = key;
      this.used = 0;
      this.tripped = false;
    }
    if (this.used >= this.limit) {
      if (!this.tripped) {
        this.tripped = true;
        this.logger.warn(
          "catalog.track_descriptor.budget_exceeded",
          "Track descriptor model-call budget reached; using deterministic tagging",
          { window: this.window, limit: this.limit, used: this.used },
        );
      }
      return false;
    }
    this.used += 1;
    return true;
  }

  get callsMade(): number {
    return this.used;
  }
}

export interface TagTracksOptions {
  /** Write descriptors. Default false: compute and report only, no model call. */
  apply?: boolean;
  budget?: ModelCallBudget;
  /** Stop tagging after this many tracks; the rest are reported as `deferred`. */
  maxToTag?: number;
  /** Model calls in flight at once (backfill). Default 1. */
  concurrency?: number;
}

export interface TagTracksResult {
  /** Strategy that actually ran (`model-assisted` needs a key). */
  strategy: TrackDescriptorStrategy;
  model: string | null;
  scanned: number;
  /** Stored hash already matches: nothing to do. */
  unchanged: number;
  /** Kept as is: an artist-written descriptor. */
  skippedArtistOwned: number;
  /** Kept as is: a model descriptor younger than the cooldown. */
  cooldown: number;
  /** Needed tagging but the per-run `maxToTag` was reached. */
  deferred: number;
  /** Tagged (written, or on a dry run would be written). */
  tagged: number;
  /** ...of which by the model. */
  fromModel: number;
  /** ...of which deterministic because the strategy is deterministic. */
  fromDeterministic: number;
  /** ...of which deterministic because the model failed (fixed reason codes). */
  fallbacks: number;
  /** ...of which deterministic because the call budget was spent. */
  overBudget: number;
  /** Model calls made (always 0 on a dry run). */
  modelCalls: number;
  /** Dry run: model calls an `--apply` run would make. */
  wouldCallModel: number;
  failed: number;
  /** Ids written or changed (apply only). */
  changedTrackIds: string[];
}

export function emptyTagResult(config: TrackDescriptorConfig): TagTracksResult {
  return {
    strategy: config.strategy,
    model: config.strategy === "model-assisted" ? config.model : null,
    scanned: 0,
    unchanged: 0,
    skippedArtistOwned: 0,
    cooldown: 0,
    deferred: 0,
    tagged: 0,
    fromModel: 0,
    fromDeterministic: 0,
    fallbacks: 0,
    overBudget: 0,
    modelCalls: 0,
    wouldCallModel: 0,
    failed: 0,
    changedTrackIds: [],
  };
}

export function mergeTagResults(a: TagTracksResult, b: TagTracksResult): TagTracksResult {
  const sum = (key: keyof TagTracksResult) => (a[key] as number) + (b[key] as number);
  return {
    ...a,
    scanned: sum("scanned"),
    unchanged: sum("unchanged"),
    skippedArtistOwned: sum("skippedArtistOwned"),
    cooldown: sum("cooldown"),
    deferred: sum("deferred"),
    tagged: sum("tagged"),
    fromModel: sum("fromModel"),
    fromDeterministic: sum("fromDeterministic"),
    fallbacks: sum("fallbacks"),
    overBudget: sum("overBudget"),
    modelCalls: sum("modelCalls"),
    wouldCallModel: sum("wouldCallModel"),
    failed: sum("failed"),
    changedTrackIds: [...a.changedTrackIds, ...b.changedTrackIds],
  };
}

/** Tracks that may carry a descriptor: clean tracks of ready or published releases. */
export const DESCRIPTOR_ELIGIBLE_WHERE: Prisma.TrackWhereInput = {
  contentStatus: "clean",
  release: { status: { in: ["ready", "published"] } },
};

const descriptorTrackSelect = {
  id: true,
  title: true,
  release: { select: { genre: true, title: true } },
  stems: {
    where: { isCurrent: true, type: "original" },
    select: { audioFeatures: true },
    take: 1,
  },
  descriptor: { select: { contentHash: true, source: true, updatedAt: true } },
} as const;

type DescriptorTrackRow = {
  id: string;
  title: string;
  release: { genre: string | null; title: string };
  stems: Array<{ audioFeatures: unknown }>;
  descriptor: { contentHash: string; source: string; updatedAt: Date } | null;
};

export interface TrackDescriptorTaggerDeps {
  env?: NodeJS.ProcessEnv;
  createClient?: (apiKey: string) => TrackDescriptorModelClient;
  now?: () => Date;
  logger?: TrackDescriptorLogger;
}

export class TrackDescriptorTagger {
  readonly config: TrackDescriptorConfig;
  private readonly createClient: (apiKey: string) => TrackDescriptorModelClient;
  private readonly now: () => Date;
  private readonly logger: TrackDescriptorLogger;
  private client: TrackDescriptorModelClient | null = null;

  constructor(deps: TrackDescriptorTaggerDeps = {}) {
    this.config = trackDescriptorConfig(deps.env ?? process.env);
    this.createClient = deps.createClient ?? createGoogleTrackDescriptorModelClient;
    this.now = deps.now ?? (() => new Date());
    this.logger = deps.logger ?? structuredDescriptorLogger;
    if (
      this.config.requestedStrategy === "model-assisted" &&
      this.config.strategy === "deterministic"
    ) {
      this.logger.warn(
        "catalog.track_descriptor.model_unavailable",
        "TRACK_DESCRIPTOR_STRATEGY=model-assisted but no model credentials are configured; using deterministic tagging",
        { reason: "missing_api_key" },
      );
    }
  }

  /** A fresh run-scoped budget from `limit` (default: the daily budget). */
  runBudget(limit = this.config.dailyCallBudget): ModelCallBudget {
    return new ModelCallBudget(limit, "run", this.now, this.logger);
  }

  /** A UTC-day budget from `TRACK_DESCRIPTOR_DAILY_CALL_BUDGET`. */
  dailyBudget(): ModelCallBudget {
    return new ModelCallBudget(this.config.dailyCallBudget, "day", this.now, this.logger);
  }

  /** Expected hash for an input under the strategy that would run now. */
  expectedHash(input: TrackDescriptorInput): string {
    return descriptorContentHash(input, this.config.strategy, this.config.model);
  }

  /** Eligible tracks among `trackIds`, with their inputs and stored descriptor state. */
  private async loadTracks(trackIds: string[]): Promise<DescriptorTrackRow[]> {
    if (trackIds.length === 0) return [];
    return (await prisma.track.findMany({
      where: { id: { in: trackIds }, ...DESCRIPTOR_ELIGIBLE_WHERE },
      select: descriptorTrackSelect,
      orderBy: { id: "asc" },
    })) as unknown as DescriptorTrackRow[];
  }

  /**
   * Tags the given tracks (eligible ones only). Never throws for a single
   * track: failures are counted.
   */
  async tagTracks(trackIds: string[], options: TagTracksOptions = {}): Promise<TagTracksResult> {
    const rows = await this.loadTracks([...new Set(trackIds.filter(Boolean))]);
    return this.tagRows(rows, options);
  }

  async tagRows(rows: DescriptorTrackRow[], options: TagTracksOptions = {}): Promise<TagTracksResult> {
    const apply = options.apply === true;
    const budget = options.budget ?? this.runBudget();
    const result = emptyTagResult(this.config);
    result.scanned = rows.length;

    type Pending = {
      row: DescriptorTrackRow;
      input: TrackDescriptorInput;
      deterministic: TrackDescriptorValue;
    };
    const pending: Pending[] = [];
    for (const row of rows) {
      if (row.descriptor?.source === "artist") {
        result.skippedArtistOwned += 1;
        continue;
      }
      const input = buildDescriptorInput({
        title: row.title,
        genre: row.release.genre,
        releaseTitle: row.release.title,
        audioFeatures: row.stems[0]?.audioFeatures,
      });
      if (row.descriptor?.contentHash === this.expectedHash(input)) {
        result.unchanged += 1;
        continue;
      }
      if (
        this.config.strategy === "model-assisted" &&
        row.descriptor?.source === "model" &&
        this.now().getTime() - row.descriptor.updatedAt.getTime() < MODEL_RETAG_COOLDOWN_MS
      ) {
        result.cooldown += 1;
        continue;
      }
      if (options.maxToTag !== undefined && pending.length >= options.maxToTag) {
        result.deferred += 1;
        continue;
      }
      pending.push({ row, input, deterministic: deterministicDescriptor(input) });
    }

    const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1));
    for (let i = 0; i < pending.length; i += concurrency) {
      const chunk = pending.slice(i, i + concurrency);
      // Budget is taken synchronously, before any await, so a chunk cannot overspend it.
      const planned = chunk.map((item) => ({
        item,
        callModel: this.config.strategy === "model-assisted" && budget.tryTake(),
      }));
      await Promise.all(
        planned.map(({ item, callModel }) => this.tagOne(item, callModel, apply, result)),
      );
    }
    return result;
  }

  private async tagOne(
    item: { row: DescriptorTrackRow; input: TrackDescriptorInput; deterministic: TrackDescriptorValue },
    callModel: boolean,
    apply: boolean,
    result: TagTracksResult,
  ): Promise<void> {
    const { row, input, deterministic } = item;
    const modelWanted = this.config.strategy === "model-assisted";
    let value = deterministic;
    let source: TrackDescriptorSource = "deterministic";
    let hashStrategy: TrackDescriptorStrategy = "deterministic";
    let outcome: "model" | "deterministic" | "fallback" | "over_budget" = "deterministic";

    if (modelWanted && !callModel) {
      outcome = "over_budget";
    } else if (modelWanted && callModel) {
      if (!apply) {
        // A dry run reports the spend; it never makes it.
        result.wouldCallModel += 1;
        result.tagged += 1;
        result.fromModel += 1;
        return;
      }
      try {
        this.client ??= this.createClient(this.config.apiKey as string);
        result.modelCalls += 1;
        const answer = await requestModelDescriptor(this.client, this.config, input);
        value = mergeModelDescriptor(deterministic, answer);
        source = "model";
        hashStrategy = "model-assisted";
        outcome = "model";
      } catch (error) {
        const reason = error instanceof TrackDescriptorModelError ? error.reason : "provider_error";
        // Fixed reason code only; provider errors can echo request content.
        this.logger.warn(
          "catalog.track_descriptor.model_failed",
          `Model track tagging failed; using deterministic tags: ${reason}`,
          { reason },
        );
        outcome = "fallback";
      }
    }

    const countOutcome = () => {
      result.tagged += 1;
      if (outcome === "model") result.fromModel += 1;
      else if (outcome === "fallback") result.fallbacks += 1;
      else if (outcome === "over_budget") result.overBudget += 1;
      else result.fromDeterministic += 1;
    };
    if (!apply) {
      countOutcome();
      return;
    }
    const contentHash = descriptorContentHash(input, hashStrategy, this.config.model);
    const data = {
      version: TRACK_DESCRIPTOR_VERSION,
      families: value.families,
      subGenres: value.subGenres,
      tempoBand: value.tempoBand,
      energyBand: value.energyBand,
      vocal: value.vocal,
      source,
      model: source === "model" ? this.config.model : null,
      contentHash,
    };
    try {
      await prisma.trackDescriptor.upsert({
        where: { trackId: row.id },
        create: { trackId: row.id, ...data },
        update: data,
      });
      countOutcome();
      result.changedTrackIds.push(row.id);
    } catch {
      result.failed += 1;
    }
  }

  /**
   * Tags the catalog page by page in id order (backfill). `maxToTag` bounds
   * the tracks tagged per run; re-run until `deferred` is 0.
   */
  async tagCatalog(
    options: TagTracksOptions & { pageSize?: number } = {},
  ): Promise<TagTracksResult> {
    const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
    const budget = options.budget ?? this.runBudget();
    let total = emptyTagResult(this.config);
    let cursor: string | undefined;
    for (;;) {
      const rows = (await prisma.track.findMany({
        where: DESCRIPTOR_ELIGIBLE_WHERE,
        select: descriptorTrackSelect,
        orderBy: { id: "asc" },
        take: pageSize,
        ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      })) as unknown as DescriptorTrackRow[];
      if (rows.length === 0) break;
      cursor = rows[rows.length - 1].id;
      const remaining =
        options.maxToTag === undefined ? undefined : Math.max(0, options.maxToTag - total.tagged);
      const page = await this.tagRows(rows, { ...options, budget, maxToTag: remaining });
      total = mergeTagResults(total, page);
      if (rows.length < pageSize) break;
    }
    return total;
  }
}
