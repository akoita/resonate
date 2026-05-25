import { Inject, Injectable, Optional } from "@nestjs/common";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import {
  ANALYTICS_REPORT_SOURCE,
  AnalyticsReportMetadata,
  ArtistAnalyticsReportSource,
  timeWindowMetadata,
} from "./analytics_bigquery_report";
import {
  AnalyticsFactRow,
  AnalyticsViewRow,
  AnalyticsWarehouseExport,
  AnalyticsWarehouseExportService,
  buildAnalyticsWarehouseExport,
} from "./analytics_warehouse";
import { AnalyticsCatalogMetadataService, AnalyticsTrackMetadata } from "./analytics_catalog_metadata.service";

interface TrackStats {
  trackId: string;
  title: string;
  plays: number;
  payoutUsd: number;
  payoutsByAsset: AssetPayoutStats[];
}

interface SessionStats {
  sessionId: string;
  plays: number;
  payoutUsd: number;
  payoutsByAsset: AssetPayoutStats[];
}

interface SourceStats {
  source: string;
  plays: number;
}

interface PlaysOverTimeStats {
  date: string;
  plays: number;
  payoutUsd: number;
}

interface ProtectionRouteStats {
  route: string;
  decisions: number;
  releases: number;
  latestDecisionAt: string | null;
}

interface ProtectionMetrics {
  totalDecisions: number;
  releasesWithDecisions: number;
  marketplaceReadyReleases: number;
  restrictedReleases: number;
  blockedReleases: number;
  routes: ProtectionRouteStats[];
}

interface AssetPayoutStats {
  paymentToken: string;
  assetId: string | null;
  symbol: string;
  decimals: number;
  settlementAmount: string;
  settlementAmountUnits: string;
  canonicalAmountUsd: number;
  count: number;
}

type MutableAssetPayoutStats = Omit<AssetPayoutStats, "settlementAmountUnits" | "canonicalAmountUsd"> & {
  settlementAmountUnits: bigint;
  canonicalAmountUsd: number;
};

interface ArtistAnalyticsData {
  facts: AnalyticsFactRow[];
  views: AnalyticsViewRow[];
  metadata: AnalyticsReportMetadata;
}

type EnrichedAnalyticsFactRow = AnalyticsFactRow & {
  catalogTrack?: AnalyticsTrackMetadata;
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly ingestService: AnalyticsIngestService,
    @Optional() private readonly warehouseExportService?: AnalyticsWarehouseExportService,
    @Optional()
    @Inject(ANALYTICS_REPORT_SOURCE)
    private readonly reportSource?: ArtistAnalyticsReportSource,
    @Optional() private readonly catalogMetadataService?: AnalyticsCatalogMetadataService,
  ) {}

  async getArtistStats(artistId: string, days: number) {
    const data = await this.listArtistData(artistId, days);
    const facts = await this.enrichFactsWithCatalogMetadata(data.facts);

    const summary = {
      artistId,
      days: data.metadata.timeWindow.days,
      totalPlays: 0,
      totalPayoutUsd: 0,
    };
    const tracks: TrackStats[] = [];
    const trackMap = new Map<string, TrackStats>();

    facts.forEach((fact) => {
      const dimensions = fact.dimensions;
      const eventName = this.stringDimension(dimensions, "eventName");
      const trackId = fact.trackId ?? "unknown";
      const title = this.trackTitle(fact);
      const stats =
        trackMap.get(trackId) ?? { trackId, title, plays: 0, payoutUsd: 0, payoutsByAsset: [] };
      if (stats.title === "Unknown Track" && title !== "Unknown Track") {
        stats.title = title;
      }
      if (this.isPlayEvent(eventName)) {
        stats.plays += 1;
        summary.totalPlays += 1;
      }
      if (this.isPayoutEvent(eventName)) {
        const amount = this.canonicalUsdAmount(fact);
        stats.payoutUsd += amount;
        stats.payoutsByAsset = this.addAssetPayout(stats.payoutsByAsset, dimensions, amount);
        summary.totalPayoutUsd += amount;
      }
      trackMap.set(trackId, stats);
    });

    tracks.push(...trackMap.values());
    return {
      summary: {
        ...summary,
        payoutsByAsset: this.aggregateAssetPayouts(tracks.flatMap((track) => track.payoutsByAsset)),
      },
      tracks,
      meta: data.metadata,
    };
  }

  async getArtistDashboard(artistId: string, days: number) {
    const data = await this.listArtistData(artistId, days);
    const facts = await this.enrichFactsWithCatalogMetadata(data.facts);

    const summary = {
      artistId,
      days: data.metadata.timeWindow.days,
      totalPlays: 0,
      totalPayoutUsd: 0,
    };
    const trackMap = new Map<string, TrackStats>();
    const sessionMap = new Map<string, SessionStats>();
    const sourceMap = new Map<string, SourceStats>();

    facts.forEach((fact) => {
      const dimensions = fact.dimensions;
      const eventName = this.stringDimension(dimensions, "eventName");
      const trackId = fact.trackId ?? "unknown";
      const title = this.trackTitle(fact);
      const sessionId = this.stringDimension(dimensions, "sessionId") ?? "unknown";
      const source = this.stringDimension(dimensions, "source") ?? "unknown";

      const trackStats =
        trackMap.get(trackId) ?? { trackId, title, plays: 0, payoutUsd: 0, payoutsByAsset: [] };
      const sessionStats =
        sessionMap.get(sessionId) ?? { sessionId, plays: 0, payoutUsd: 0, payoutsByAsset: [] };
      const sourceStats = sourceMap.get(source) ?? { source, plays: 0 };

      if (trackStats.title === "Unknown Track" && title !== "Unknown Track") {
        trackStats.title = title;
      }
      if (this.isPlayEvent(eventName)) {
        trackStats.plays += 1;
        sessionStats.plays += 1;
        sourceStats.plays += 1;
        summary.totalPlays += 1;
      }
      if (this.isPayoutEvent(eventName)) {
        const amount = this.canonicalUsdAmount(fact);
        trackStats.payoutUsd += amount;
        sessionStats.payoutUsd += amount;
        trackStats.payoutsByAsset = this.addAssetPayout(trackStats.payoutsByAsset, dimensions, amount);
        sessionStats.payoutsByAsset = this.addAssetPayout(sessionStats.payoutsByAsset, dimensions, amount);
        summary.totalPayoutUsd += amount;
      }

      trackMap.set(trackId, trackStats);
      sessionMap.set(sessionId, sessionStats);
      sourceMap.set(source, sourceStats);
    });

    const exportPayload = {
      artistId,
      days: data.metadata.timeWindow.days,
      totalPlays: summary.totalPlays,
      totalPayoutUsd: summary.totalPayoutUsd,
      payoutsByAsset: this.aggregateAssetPayouts(
        [...trackMap.values()].flatMap((track) => track.payoutsByAsset),
      ),
      generatedAt: data.metadata.generatedAt,
      source: data.metadata.source,
      freshness: data.metadata.freshness,
    };
    const tracks = [...trackMap.values()];

    return {
      summary: {
        ...summary,
        payoutsByAsset: exportPayload.payoutsByAsset,
      },
      tracks,
      topTracks: this.topTracks(tracks),
      sessions: [...sessionMap.values()],
      sources: [...sourceMap.values()],
      playsOverTime: this.playsOverTime(data.views, facts),
      trackPerformance: tracks,
      protection: this.protectionMetrics(facts),
      listenerGrowth: {
        status: "unavailable",
        reason: "listener and follower growth events are not available in the current analytics event model",
      },
      export: exportPayload,
      meta: data.metadata,
    };
  }

  private async listArtistData(artistId: string, days: number): Promise<ArtistAnalyticsData> {
    const normalizedDays = this.normalizedDays(days);
    const to = new Date();
    const from = new Date(to.getTime() - normalizedDays * 24 * 60 * 60 * 1000);
    const reportResult = await this.reportSource?.listArtistFacts({ artistId, from, to });
    if (reportResult) {
      return reportResult;
    }

    const exportPayload = await this.exportLayers();
    const facts = exportPayload.analyticsFacts.filter(
      (fact) =>
        fact.artistId === artistId &&
        new Date(fact.occurredAt).getTime() >= from.getTime() &&
        new Date(fact.occurredAt).getTime() < to.getTime(),
    );
    const views = exportPayload.analyticsViews.filter(
      (view) =>
        view.artistId === artistId &&
        new Date(`${view.date}T00:00:00.000Z`).getTime() >= startOfUtcDate(from).getTime() &&
        new Date(`${view.date}T00:00:00.000Z`).getTime() < startOfUtcDate(to).getTime(),
    );
    const freshness = this.freshnessFromFacts(facts, to);
    return {
      facts,
      views,
      metadata: {
        source: "warehouse_export",
        generatedAt: exportPayload.generatedAt,
        timeWindow: timeWindowMetadata(from, to),
        freshness,
        isEmpty: facts.length === 0 && views.length === 0,
        cache: {
          hit: false,
          ttlSeconds: 0,
        },
      },
    };
  }

  private async exportLayers(): Promise<AnalyticsWarehouseExport> {
    if (this.warehouseExportService) {
      return this.warehouseExportService.exportLayers();
    }
    return buildAnalyticsWarehouseExport(await this.ingestService.listEvents());
  }

  private async enrichFactsWithCatalogMetadata(facts: AnalyticsFactRow[]): Promise<EnrichedAnalyticsFactRow[]> {
    if (!this.catalogMetadataService) {
      return facts;
    }

    const trackIds = facts
      .map((fact) => fact.trackId)
      .filter((trackId): trackId is string => typeof trackId === "string" && trackId.length > 0);
    const tracksById = await this.catalogMetadataService.findTracks(trackIds);
    if (tracksById.size === 0) {
      return facts;
    }

    return facts.map((fact) => {
      const catalogTrack = fact.trackId ? tracksById.get(fact.trackId) : undefined;
      if (!catalogTrack) {
        return fact;
      }

      return {
        ...fact,
        releaseId: fact.releaseId ?? catalogTrack.releaseId,
        artistId: fact.artistId ?? catalogTrack.artistId,
        dimensions: {
          ...fact.dimensions,
          title: this.stringDimension(fact.dimensions, "title") ?? catalogTrack.title,
          releaseId: this.stringDimension(fact.dimensions, "releaseId") ?? catalogTrack.releaseId,
          releaseTitle: this.stringDimension(fact.dimensions, "releaseTitle") ?? catalogTrack.releaseTitle,
          artistId: this.stringDimension(fact.dimensions, "artistId") ?? catalogTrack.artistId,
          artistName: this.stringDimension(fact.dimensions, "artistName") ?? catalogTrack.artistName ?? undefined,
        },
        catalogTrack,
      };
    });
  }

  private isPlayEvent(eventName?: string) {
    return eventName === "license.granted" || eventName === "playback.completed";
  }

  private isPayoutEvent(eventName?: string) {
    return eventName === "payment.settled" || eventName === "commerce.settled";
  }

  private topTracks(tracks: TrackStats[]) {
    return [...tracks].sort((left, right) => right.plays - left.plays || right.payoutUsd - left.payoutUsd).slice(0, 10);
  }

  private trackTitle(fact: EnrichedAnalyticsFactRow) {
    return this.stringDimension(fact.dimensions, "title") ?? fact.catalogTrack?.title ?? "Unknown Track";
  }

  private playsOverTime(views: AnalyticsViewRow[], facts: AnalyticsFactRow[]): PlaysOverTimeStats[] {
    if (views.length > 0) {
      const byDate = new Map<string, PlaysOverTimeStats>();
      for (const view of views) {
        const row = byDate.get(view.date) ?? { date: view.date, plays: 0, payoutUsd: 0 };
        row.plays += view.playCount;
        row.payoutUsd += view.payoutUsd;
        byDate.set(view.date, row);
      }
      return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
    }

    const byDate = new Map<string, PlaysOverTimeStats>();
    for (const fact of facts) {
      const eventName = this.stringDimension(fact.dimensions, "eventName");
      const row = byDate.get(fact.occurredDate) ?? { date: fact.occurredDate, plays: 0, payoutUsd: 0 };
      if (this.isPlayEvent(eventName)) {
        row.plays += fact.count;
      }
      if (this.isPayoutEvent(eventName)) {
        row.payoutUsd += this.canonicalUsdAmount(fact);
      }
      byDate.set(fact.occurredDate, row);
    }
    return [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date));
  }

  private protectionMetrics(facts: AnalyticsFactRow[]): ProtectionMetrics {
    const routeMap = new Map<string, { decisions: number; releases: Set<string>; latestDecisionAt: string | null }>();
    const latestByRelease = new Map<string, { route: string; occurredAt: string }>();

    for (const fact of facts) {
      if (this.stringDimension(fact.dimensions, "eventName") !== "rights.route_decided") {
        continue;
      }

      const route = this.stringDimension(fact.dimensions, "route") ?? "unknown";
      const releaseId = fact.releaseId ?? this.stringDimension(fact.dimensions, "releaseId") ?? "unknown";
      const occurredAt = fact.occurredAt;
      const routeStats =
        routeMap.get(route) ?? { decisions: 0, releases: new Set<string>(), latestDecisionAt: null };
      routeStats.decisions += fact.count;
      routeStats.releases.add(releaseId);
      routeStats.latestDecisionAt =
        routeStats.latestDecisionAt === null || Date.parse(occurredAt) > Date.parse(routeStats.latestDecisionAt)
          ? occurredAt
          : routeStats.latestDecisionAt;
      routeMap.set(route, routeStats);

      const current = latestByRelease.get(releaseId);
      if (!current || Date.parse(occurredAt) >= Date.parse(current.occurredAt)) {
        latestByRelease.set(releaseId, { route, occurredAt });
      }
    }

    const latestRoutes = [...latestByRelease.values()].map((decision) => decision.route);
    return {
      totalDecisions: [...routeMap.values()].reduce((total, route) => total + route.decisions, 0),
      releasesWithDecisions: latestByRelease.size,
      marketplaceReadyReleases: latestRoutes.filter((route) => route === "STANDARD_ESCROW" || route === "TRUSTED_FAST_PATH").length,
      restrictedReleases: latestRoutes.filter((route) =>
        route === "LIMITED_MONITORING" || route === "QUARANTINED_REVIEW" || route === "BLOCKED",
      ).length,
      blockedReleases: latestRoutes.filter((route) => route === "BLOCKED").length,
      routes: [...routeMap.entries()]
        .map(([route, stats]) => ({
          route,
          decisions: stats.decisions,
          releases: stats.releases.size,
          latestDecisionAt: stats.latestDecisionAt,
        }))
        .sort((left, right) => right.decisions - left.decisions || left.route.localeCompare(right.route)),
    };
  }

  private normalizedDays(days: number) {
    return Number.isInteger(days) && days > 0 ? Math.min(days, 366) : 30;
  }

  private freshnessFromFacts(facts: AnalyticsFactRow[], now: Date) {
    const asOf = facts.reduce<string | null>((latest, fact) => {
      if (!fact.occurredAt) {
        return latest;
      }
      return latest === null || Date.parse(fact.occurredAt) > Date.parse(latest) ? fact.occurredAt : latest;
    }, null);

    return {
      asOf,
      lagSeconds: asOf === null ? null : Math.max(0, Math.floor((now.getTime() - Date.parse(asOf)) / 1000)),
    };
  }

  private canonicalUsdAmount(fact: AnalyticsFactRow) {
    return Number(fact.canonicalAmountUsd ?? this.numberDimension(fact.dimensions, "amountUsd") ?? 0);
  }

  private addAssetPayout(
    payouts: AssetPayoutStats[],
    dimensions: Record<string, unknown>,
    canonicalAmountUsd: number,
  ): AssetPayoutStats[] {
    return this.aggregateAssetPayouts([
      ...payouts,
      {
        paymentToken: this.stringDimension(dimensions, "paymentToken") ?? "0x0000000000000000000000000000000000000000",
        assetId: this.stringDimension(dimensions, "paymentAssetId") ?? null,
        symbol: this.stringDimension(dimensions, "paymentAssetSymbol") ?? this.stringDimension(dimensions, "currency") ?? "USD",
        decimals: this.numberDimension(dimensions, "paymentAssetDecimals") ?? 2,
        settlementAmount: this.stringDimension(dimensions, "settlementAmount") ?? this.stringDimension(dimensions, "amount") ?? String(canonicalAmountUsd),
        settlementAmountUnits: this.stringDimension(dimensions, "settlementAmountUnits") ?? this.stringDimension(dimensions, "amountUnits") ?? "0",
        canonicalAmountUsd,
        count: 1,
      },
    ]);
  }

  private aggregateAssetPayouts(payouts: AssetPayoutStats[]): AssetPayoutStats[] {
    const byToken = new Map<string, MutableAssetPayoutStats>();
    for (const payout of payouts) {
      const key = `${payout.paymentToken}:${payout.assetId ?? ""}:${payout.symbol}`;
      const current = byToken.get(key) ?? {
        paymentToken: payout.paymentToken,
        assetId: payout.assetId,
        symbol: payout.symbol,
        decimals: payout.decimals,
        settlementAmount: "0",
        settlementAmountUnits: 0n,
        canonicalAmountUsd: 0,
        count: 0,
      };
      current.settlementAmountUnits += BigInt(payout.settlementAmountUnits || "0");
      current.canonicalAmountUsd += payout.canonicalAmountUsd;
      current.count += payout.count;
      byToken.set(key, current);
    }

    return [...byToken.values()].map((payout) => ({
      ...payout,
      settlementAmountUnits: payout.settlementAmountUnits.toString(),
      settlementAmount: this.formatUnits(payout.settlementAmountUnits, payout.decimals),
      canonicalAmountUsd: Number(payout.canonicalAmountUsd.toFixed(12)),
    }));
  }

  private formatUnits(value: bigint, decimals: number) {
    const sign = value < 0n ? "-" : "";
    const absolute = value < 0n ? -value : value;
    const scale = 10n ** BigInt(decimals);
    const integer = absolute / scale;
    const fraction = absolute % scale;
    if (fraction === 0n) {
      return `${sign}${integer.toString()}`;
    }
    const fractionText = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
    return `${sign}${integer.toString()}.${fractionText}`;
  }

  private stringDimension(dimensions: Record<string, unknown>, key: string) {
    const value = dimensions[key];
    return typeof value === "string" ? value : undefined;
  }

  private numberDimension(dimensions: Record<string, unknown>, key: string) {
    const value = dimensions[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
}

function startOfUtcDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}
