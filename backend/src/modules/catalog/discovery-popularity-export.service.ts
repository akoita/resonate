import { Logger } from "@nestjs/common";
import { GoogleAuth } from "google-auth-library";
import { prisma } from "../../db/prisma";
import { RedisCacheService } from "../shared/redis_cache.service";
import { AI_PROMOTIONAL_ELIGIBILITY_WHERE } from "./ai-disclosure.policy";
import {
  DiscoveryPopularityConfig,
  DISCOVERY_POPULARITY_CACHE_TTL_SECONDS,
  PopularityWindow,
  discoveryPopularityConfigFromEnv,
  rotatePopularityCacheGeneration,
} from "./discovery-popularity.math";

const BIGQUERY_PAGE_SIZE = 10_000;
const POSTGRES_INSERT_CHUNK_SIZE = 1_000;
const POSTGRES_CATALOG_LOOKUP_CHUNK_SIZE = 1_000;
const SUPPORTED_WINDOWS = new Set<PopularityWindow>(["24h", "7d", "30d"]);

export interface DiscoveryTrackPopularityRow {
  trackId: string;
  window: PopularityWindow;
  genre: string;
  score: number;
  plays: number;
  uniqueListeners: number;
  saves: number;
  purchases: number;
  computedAt: Date;
}

export interface DiscoveryArtistEngagementRow {
  artistId: string;
  window: PopularityWindow;
  genre: string;
  score: number;
  plays: number;
  uniqueListeners: number;
  saves: number;
  purchases: number;
  computedAt: Date;
}

export interface DiscoveryPopularityBigQueryClient {
  readMart(tableName: string, mart: "track" | "artist" | "snapshot"): Promise<Record<string, unknown>[]>;
}

export interface BigQueryRequestClient {
  request<T>(request: {
    url: string;
    method: "GET" | "POST";
    timeout: number;
    data?: unknown;
    params?: Record<string, unknown>;
  }): Promise<{ data: T }>;
}

interface BigQueryField {
  name: string;
  type?: string;
}

interface BigQueryRow {
  f?: Array<{ v?: unknown }>;
}

interface BigQueryError {
  message?: string;
  reason?: string;
}

interface BigQueryQueryResponse {
  jobComplete?: boolean;
  jobReference?: { jobId?: string; location?: string };
  schema?: { fields?: BigQueryField[] };
  rows?: BigQueryRow[];
  pageToken?: string;
  totalRows?: string;
  errors?: BigQueryError[];
  status?: { errorResult?: BigQueryError; errors?: BigQueryError[] };
}

export class DiscoveryPopularityExportService {
  private readonly logger = new Logger(DiscoveryPopularityExportService.name);
  private readonly config: DiscoveryPopularityConfig;
  private readonly bigQuery: DiscoveryPopularityBigQueryClient;

  constructor(
    private readonly redisCache?: RedisCacheService,
    config?: DiscoveryPopularityConfig,
    bigQuery?: DiscoveryPopularityBigQueryClient,
  ) {
    this.config = config ?? discoveryPopularityConfigFromEnv();
    this.bigQuery = bigQuery ?? new GoogleAuthDiscoveryPopularityBigQueryClient(this.config);
  }

  /**
   * Read only Dataform's precomputed serving marts and replace both Postgres
   * tables in one transaction. A failed, truncated, over-limit, or invalid
   * read leaves the currently served snapshot intact.
   */
  async refreshFromWarehouse() {
    if (this.config.source !== "warehouse") {
      throw new Error("Set DISCOVERY_POPULARITY_SOURCE=warehouse before exporting popularity marts");
    }

    const startedAt = new Date();
    const [rawTrackRows, rawArtistRows, rawSnapshotRows] = await Promise.all([
      this.bigQuery.readMart(this.config.trackPopularityTable, "track"),
      this.bigQuery.readMart(this.config.artistEngagementTable, "artist"),
      this.bigQuery.readMart(this.config.snapshotTable, "snapshot"),
    ]);
    const snapshot = parseSnapshotRows(
      rawSnapshotRows,
      rawTrackRows.length,
      rawArtistRows.length,
      startedAt,
      this.config.snapshotMaxAgeMinutes,
    );
    const trackRows = parseTrackRows(
      rawTrackRows,
      this.config.minimumAudience,
      startedAt,
      this.config.snapshotMaxAgeMinutes,
    );
    const artistRows = parseArtistRows(
      rawArtistRows,
      this.config.minimumAudience,
      startedAt,
      this.config.snapshotMaxAgeMinutes,
    );
    assertRowsPrecedeSnapshot(trackRows, snapshot.computedAt, "track");
    assertRowsPrecedeSnapshot(artistRows, snapshot.computedAt, "artist");
    const checked = await this.checkPostgresCatalogEligibility(trackRows, artistRows);

    await this.replaceAll(checked.trackRows, checked.artistRows);
    this.logger.log(
      `Warehouse popularity snapshot replaced: ${checked.trackRows.length} track rows, ` +
        `${checked.artistRows.length} artist rows (threshold ${this.config.minimumAudience})`,
    );
    return {
      trackRows: checked.trackRows.length,
      artistRows: checked.artistRows.length,
      minimumAudience: this.config.minimumAudience,
      computedAt: snapshot.computedAt.toISOString(),
    };
  }

  private async replaceAll(
    trackRows: DiscoveryTrackPopularityRow[],
    artistRows: DiscoveryArtistEngagementRow[],
  ) {
    await prisma.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(1450, 1) IS NULL AS locked`;
        await tx.trackPopularity.deleteMany();
        await tx.artistEngagement.deleteMany();
        for (let offset = 0; offset < trackRows.length; offset += POSTGRES_INSERT_CHUNK_SIZE) {
          await tx.trackPopularity.createMany({
            data: trackRows.slice(offset, offset + POSTGRES_INSERT_CHUNK_SIZE),
          });
        }
        for (let offset = 0; offset < artistRows.length; offset += POSTGRES_INSERT_CHUNK_SIZE) {
          await tx.artistEngagement.createMany({
            data: artistRows.slice(offset, offset + POSTGRES_INSERT_CHUNK_SIZE),
          });
        }
      },
      { maxWait: 10_000, timeout: 180_000 },
    );
    await rotatePopularityCacheGeneration(this.redisCache);
  }

  private async checkPostgresCatalogEligibility(
    trackRows: DiscoveryTrackPopularityRow[],
    artistRows: DiscoveryArtistEngagementRow[],
  ) {
    const sourceTrackIds = [...new Set(trackRows.map((row) => row.trackId))];
    const sourceArtistIds = [...new Set(artistRows.map((row) => row.artistId))];
    const tracks = [];
    for (const ids of chunksOf(sourceTrackIds, POSTGRES_CATALOG_LOOKUP_CHUNK_SIZE)) {
      tracks.push(...await prisma.track.findMany({
        where: { id: { in: ids } },
        select: {
          id: true,
          aiDisclosureLevel: true,
          release: {
            select: {
              artistId: true,
              artistCredits: {
                select: { artistId: true, identityStatus: true },
              },
            },
          },
        },
      }));
    }
    const artists = [];
    for (const ids of chunksOf(sourceArtistIds, POSTGRES_CATALOG_LOOKUP_CHUNK_SIZE)) {
      artists.push(...await prisma.artist.findMany({
        where: { id: { in: ids } },
        select: { id: true },
      }));
    }

    const tracksById = new Map(tracks.map((track) => [track.id, track]));
    const ineligibleArtistIds = new Set<string>();
    const eligibleTrackRows = trackRows.filter((row) => {
      const track = tracksById.get(row.trackId);
      if (!track) return false;
      const disallowedLevel = AI_PROMOTIONAL_ELIGIBILITY_WHERE.aiDisclosureLevel.not;
      if (track.aiDisclosureLevel !== disallowedLevel) return true;

      // Artist marts have already rolled up event contributions. If current
      // authoritative catalog metadata says one of those tracks is fully AI,
      // suppress its credited artists' aggregate rather than serve a score that
      // could contain that excluded track's contribution.
      ineligibleArtistIds.add(track.release.artistId);
      for (const credit of track.release.artistCredits) {
        if (credit.identityStatus !== "ambiguous") ineligibleArtistIds.add(credit.artistId);
      }
      return false;
    });

    const existingArtistIds = new Set(artists.map((artist) => artist.id));
    const eligibleArtistRows = artistRows.filter(
      (row) => existingArtistIds.has(row.artistId) && !ineligibleArtistIds.has(row.artistId),
    );
    return { trackRows: eligibleTrackRows, artistRows: eligibleArtistRows };
  }
}

export class GoogleAuthDiscoveryPopularityBigQueryClient implements DiscoveryPopularityBigQueryClient {
  private readonly auth = new GoogleAuth({
    scopes: ["https://www.googleapis.com/auth/bigquery.readonly"],
  });
  private readonly timeoutMs: number;
  private readonly maximumBytesBilled: string;
  private readonly rowLimit: number;
  private readonly projectId: string;
  private readonly datasetId: string;
  private readonly apiBaseUrl: string;
  private readonly testRequestClient?: BigQueryRequestClient;

  constructor(
    config = discoveryPopularityConfigFromEnv(),
    requestClient?: BigQueryRequestClient,
    private readonly now: () => number = () => Date.now(),
    private readonly pause: (milliseconds: number) => Promise<void> = delay,
  ) {
    this.timeoutMs = config.queryTimeoutMs;
    this.maximumBytesBilled = config.maximumBytesBilled;
    this.rowLimit = config.rowLimit;
    this.projectId = config.projectId;
    this.datasetId = config.datasetId;
    this.apiBaseUrl = config.apiBaseUrl;
    this.testRequestClient = requestClient;
  }

  async readMart(tableName: string, mart: "track" | "artist" | "snapshot") {
    const table = bigQueryIdentifier(tableName, "mart table");
    const columns = mart === "track"
      ? "track_id, window, genre, score, plays, unique_listeners, saves, purchases, computed_at"
      : mart === "artist"
        ? "artist_id, window, genre, score, plays, unique_listeners, saves, purchases, computed_at"
        : "computed_at, track_rows, artist_rows";
    const orderBy = mart === "snapshot"
      ? "computed_at"
      : `window, genre, ${mart === "track" ? "track_id" : "artist_id"}`;
    const query = `SELECT ${columns} FROM \`${bigQueryIdentifier(this.projectId, "project")}.${bigQueryIdentifier(this.datasetId, "dataset")}.${table}\` ORDER BY ${orderBy} LIMIT @resultLimit`;
    const deadline = this.now() + this.timeoutMs;
    const initial = await this.request<BigQueryQueryResponse>(
      "POST",
      `${this.apiBaseUrl.replace(/\/$/, "")}/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/queries`,
      {
        data: {
          kind: "bigquery#queryRequest",
          query,
          useLegacySql: false,
          useQueryCache: true,
          maximumBytesBilled: this.maximumBytesBilled,
          timeoutMs: Math.min(10_000, Math.max(1, deadline - this.now())),
          maxResults: BIGQUERY_PAGE_SIZE,
          parameterMode: "NAMED",
          queryParameters: [
            {
              name: "resultLimit",
              parameterType: { type: "INT64" },
              parameterValue: { value: String(this.rowLimit + 1) },
            },
          ],
        },
      },
      deadline,
    );

    let response = initial;
    if (response.jobComplete !== true) {
      response = await this.waitForCompletion(response, deadline);
    }
    assertQuerySucceeded(response);
    const totalRows = parseTotalRows(response.totalRows);
    const fields = response.schema?.fields;
    if (!fields?.length) {
      if (totalRows === 0) return [];
      throw new Error(`BigQuery ${mart} popularity mart response omitted its schema`);
    }

    const rows: Record<string, unknown>[] = [];
    let page = response;
    const seenPageTokens = new Set<string>();
    while (true) {
      assertQuerySucceeded(page);
      rows.push(...decodeBigQueryRows(fields, page.rows ?? []));
      if (rows.length > this.rowLimit) {
        throw new Error(`BigQuery ${mart} popularity mart exceeded row limit ${this.rowLimit}`);
      }
      if (!page.pageToken) break;
      const requestedPageToken = page.pageToken;
      if (seenPageTokens.has(requestedPageToken)) {
        throw new Error(`BigQuery ${mart} popularity mart repeated a page token`);
      }
      seenPageTokens.add(requestedPageToken);
      page = await this.request<BigQueryQueryResponse>(
        "GET",
        this.queryResultsUrl(response.jobReference?.jobId),
        {
          params: {
            maxResults: BIGQUERY_PAGE_SIZE,
            pageToken: requestedPageToken,
            timeoutMs: Math.min(1_000, Math.max(1, deadline - this.now())),
            ...(response.jobReference?.location ? { location: response.jobReference.location } : {}),
          },
        },
        deadline,
      );
      if (page.jobComplete !== true) {
        page = await this.waitForCompletion(
          page,
          deadline,
          response.jobReference?.jobId,
          requestedPageToken,
        );
      }
      if (page.schema?.fields && !sameSchema(fields, page.schema.fields)) {
        throw new Error(`BigQuery ${mart} popularity mart changed schema while paginating`);
      }
      if (page.totalRows !== undefined && parseTotalRows(page.totalRows) !== totalRows) {
        throw new Error(`BigQuery ${mart} popularity mart changed totalRows while paginating`);
      }
    }

    if (rows.length !== totalRows) {
      throw new Error(`BigQuery ${mart} popularity mart returned ${rows.length} of ${totalRows} rows`);
    }
    if (totalRows > this.rowLimit) {
      throw new Error(`BigQuery ${mart} popularity mart exceeded row limit ${this.rowLimit}`);
    }
    return rows;
  }

  private async waitForCompletion(
    first: BigQueryQueryResponse,
    deadline: number,
    knownJobId?: string,
    pageToken?: string,
  ) {
    const jobId = knownJobId || first.jobReference?.jobId;
    if (!jobId) throw new Error("BigQuery popularity query is incomplete and has no job id");
    let response = first;
    while (response.jobComplete !== true) {
      const remaining = deadline - this.now();
      if (remaining <= 0) throw new Error(`BigQuery popularity query ${jobId} timed out`);
      await this.pause(Math.min(250, remaining));
      response = await this.request<BigQueryQueryResponse>(
        "GET",
        this.queryResultsUrl(jobId),
        {
          params: {
            maxResults: BIGQUERY_PAGE_SIZE,
            timeoutMs: Math.min(1_000, Math.max(1, deadline - this.now())),
            ...(pageToken ? { pageToken } : {}),
            ...(first.jobReference?.location ? { location: first.jobReference.location } : {}),
          },
        },
        deadline,
      );
    }
    return response;
  }

  private queryResultsUrl(jobId?: string) {
    if (!jobId) throw new Error("BigQuery popularity query response omitted its job id");
    return `${this.apiBaseUrl.replace(/\/$/, "")}/bigquery/v2/projects/${encodeURIComponent(this.projectId)}/queries/${encodeURIComponent(jobId)}`;
  }

  private async request<T>(
    method: "GET" | "POST",
    url: string,
    options: { data?: unknown; params?: Record<string, unknown> },
    deadline: number,
  ): Promise<T> {
    if (deadline - this.now() <= 0) throw new Error("BigQuery popularity query timed out");
    const client = this.testRequestClient ?? await this.auth.getClient();
    const remaining = deadline - this.now();
    if (remaining <= 0) throw new Error("BigQuery popularity query timed out");
    const result = await client.request<T>({
      url,
      method,
      timeout: Math.min(this.timeoutMs, remaining),
      ...options,
    });
    if (this.now() >= deadline) throw new Error("BigQuery popularity query timed out");
    return result.data;
  }
}

function parseTrackRows(
  rows: Record<string, unknown>[],
  minimumAudience: number,
  startedAt: Date,
  maximumAgeMinutes: number,
): DiscoveryTrackPopularityRow[] {
  const parsed = rows.map((row) => ({
    trackId: requiredString(row.track_id ?? row.trackId, "track_id"),
    window: popularityWindow(row.window),
    genre: requiredGenre(row.genre),
    score: finiteNonNegative(row.score, "score"),
    plays: nonNegativeInteger(row.plays, "plays"),
    uniqueListeners: nonNegativeInteger(row.unique_listeners ?? row.uniqueListeners, "unique_listeners"),
    saves: nonNegativeInteger(row.saves, "saves"),
    purchases: nonNegativeInteger(row.purchases, "purchases"),
    computedAt: freshTimestamp(row.computed_at ?? row.computedAt, "track", startedAt, maximumAgeMinutes),
  }));
  assertUniqueRows(parsed, (row) => `${row.trackId}\u0000${row.window}\u0000${row.genre}`);
  assertMinimumAudience(parsed, minimumAudience, "track");
  return parsed;
}

function parseArtistRows(
  rows: Record<string, unknown>[],
  minimumAudience: number,
  startedAt: Date,
  maximumAgeMinutes: number,
): DiscoveryArtistEngagementRow[] {
  const parsed = rows.map((row) => ({
    artistId: requiredString(row.artist_id ?? row.artistId, "artist_id"),
    window: popularityWindow(row.window),
    genre: requiredGenre(row.genre),
    score: finiteNonNegative(row.score, "score"),
    plays: nonNegativeInteger(row.plays, "plays"),
    uniqueListeners: nonNegativeInteger(row.unique_listeners ?? row.uniqueListeners, "unique_listeners"),
    saves: nonNegativeInteger(row.saves, "saves"),
    purchases: nonNegativeInteger(row.purchases, "purchases"),
    computedAt: freshTimestamp(row.computed_at ?? row.computedAt, "artist", startedAt, maximumAgeMinutes),
  }));
  assertUniqueRows(parsed, (row) => `${row.artistId}\u0000${row.window}\u0000${row.genre}`);
  assertMinimumAudience(parsed, minimumAudience, "artist");
  return parsed;
}

function parseSnapshotRows(
  rows: Record<string, unknown>[],
  expectedTrackRows: number,
  expectedArtistRows: number,
  startedAt: Date,
  maximumAgeMinutes: number,
) {
  if (rows.length !== 1) {
    throw new Error("BigQuery discovery popularity snapshot must contain exactly one freshness row");
  }
  const row = rows[0];
  const computedAt = freshTimestamp(
    row.computed_at ?? row.computedAt,
    "snapshot",
    startedAt,
    maximumAgeMinutes,
  );
  const trackRows = nonNegativeInteger(row.track_rows ?? row.trackRows, "snapshot track_rows");
  const artistRows = nonNegativeInteger(row.artist_rows ?? row.artistRows, "snapshot artist_rows");
  if (trackRows !== expectedTrackRows || artistRows !== expectedArtistRows) {
    throw new Error("BigQuery popularity snapshot row counts do not match the serving marts");
  }
  return { computedAt, trackRows, artistRows };
}

function assertRowsPrecedeSnapshot(
  rows: Array<{ computedAt: Date }>,
  snapshotAt: Date,
  mart: string,
) {
  if (rows.some((row) => row.computedAt.getTime() > snapshotAt.getTime())) {
    throw new Error(`BigQuery popularity ${mart} mart is newer than its snapshot metadata row`);
  }
}

function freshTimestamp(
  value: unknown,
  source: string,
  now: Date,
  maximumAgeMinutes: number,
) {
  const milliseconds = value instanceof Date
    ? value.getTime()
    : typeof value === "string" && value.trim()
      ? Date.parse(value)
      : NaN;
  if (!Number.isFinite(milliseconds)) {
    throw new Error(`BigQuery popularity ${source} row returned an invalid computed_at`);
  }
  const timestamp = new Date(milliseconds);
  const ageMs = now.getTime() - timestamp.getTime();
  if (ageMs < 0) {
    throw new Error(`BigQuery popularity ${source} row has a future computed_at`);
  }
  if (ageMs > maximumAgeMinutes * 60_000) {
    throw new Error(`BigQuery popularity ${source} row is older than ${maximumAgeMinutes} minutes`);
  }
  return timestamp;
}

function chunksOf<T>(values: T[], chunkSize: number) {
  const chunks: T[][] = [];
  for (let offset = 0; offset < values.length; offset += chunkSize) {
    chunks.push(values.slice(offset, offset + chunkSize));
  }
  return chunks;
}

function assertUniqueRows<T>(rows: T[], keyFor: (row: T) => string) {
  const seen = new Set<string>();
  for (const row of rows) {
    const key = keyFor(row);
    if (seen.has(key)) throw new Error(`Popularity mart returned a duplicate serving key: ${key}`);
    seen.add(key);
  }
}

function assertMinimumAudience<T extends { uniqueListeners: number }>(
  rows: T[],
  minimumAudience: number,
  mart: string,
) {
  if (rows.some((row) => row.uniqueListeners < minimumAudience)) {
    throw new Error(`Popularity ${mart} mart returned a row below minimum audience ${minimumAudience}`);
  }
}

function popularityWindow(value: unknown): PopularityWindow {
  if (typeof value !== "string" || !SUPPORTED_WINDOWS.has(value as PopularityWindow)) {
    throw new Error(`Popularity mart returned unsupported window ${String(value)}`);
  }
  return value as PopularityWindow;
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`Popularity mart returned an empty ${field}`);
  }
  return value.trim();
}

function requiredGenre(value: unknown) {
  if (typeof value !== "string") throw new Error("Popularity mart returned a missing genre");
  return value;
}

function finiteNonNegative(value: unknown, field: string) {
  const number = strictNumber(value, field);
  if (number < 0) throw new Error(`Popularity mart returned negative ${field}`);
  return number;
}

function nonNegativeInteger(value: unknown, field: string) {
  const number = strictNumber(value, field);
  if (!Number.isSafeInteger(number) || number < 0 || number > 2_147_483_647) {
    throw new Error(`Popularity mart returned invalid ${field}`);
  }
  return number;
}

function strictNumber(value: unknown, field: string) {
  const number = typeof value === "number" ? value : typeof value === "string" && value.trim() ? Number(value) : NaN;
  if (!Number.isFinite(number)) throw new Error(`Popularity mart returned invalid ${field}`);
  return number;
}

function parseTotalRows(value: unknown) {
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new Error("BigQuery popularity query omitted a valid totalRows value");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new Error("BigQuery popularity totalRows exceeded safe integer range");
  return parsed;
}

function decodeBigQueryRows(fields: BigQueryField[], rows: BigQueryRow[]) {
  return rows.map((row) => {
    if (!Array.isArray(row.f) || row.f.length !== fields.length) {
      throw new Error("BigQuery popularity mart returned a row with an incomplete schema");
    }
    return Object.fromEntries(fields.map((field, index) => [field.name, row.f?.[index]?.v]));
  });
}

function sameSchema(left: BigQueryField[], right: BigQueryField[]) {
  return left.length === right.length && left.every((field, index) =>
    field.name === right[index]?.name && field.type === right[index]?.type,
  );
}

function assertQuerySucceeded(response: BigQueryQueryResponse) {
  const error = response.status?.errorResult ?? response.errors?.[0] ?? response.status?.errors?.[0];
  if (error) {
    throw new Error(`BigQuery popularity query failed: ${error.message ?? error.reason ?? "query error"}`);
  }
}

function bigQueryIdentifier(value: string, name: string) {
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new Error(`Invalid BigQuery ${name}: ${value}`);
  return value;
}

function delay(milliseconds: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
}
