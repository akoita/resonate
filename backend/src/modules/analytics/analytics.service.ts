import { Inject, Injectable, Optional } from "@nestjs/common";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import {
  ANALYTICS_REPORT_SOURCE,
  AgentQualityFactResult,
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

interface AgentQualityBreakdown {
  key: string;
  label: string;
  sessionsStarted: number;
  nextPickRequests: number;
  acceptedPicks: number;
  acceptanceRate: number;
  completionRate: number;
  saveRate: number;
  purchaseRate: number;
  averageSessionDurationMs: number | null;
}

interface AgentQualityTimePoint {
  date: string;
  sessionsStarted: number;
  nextPickRequests: number;
  acceptedPicks: number;
  completions: number;
  saves: number;
  purchases: number;
}

interface AgentQualityData {
  facts: AnalyticsFactRow[];
  metadata: AnalyticsReportMetadata;
}

type AgentQualityMetric =
  | "session_started"
  | "session_stopped"
  | "intent_selected"
  | "next_pick_requested"
  | "accepted_pick"
  | "playback_completed"
  | "first_pick_skip"
  | "save"
  | "playlist_add"
  | "purchase"
  | "other";

interface AgentQualityAccumulator {
  key: string;
  label: string;
  sessionsStarted: number;
  nextPickRequests: number;
  acceptedPicks: number;
  playbackCompletions: number;
  saves: number;
  playlistAdds: number;
  purchases: number;
  sessionDurationsMs: number[];
}

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
      playsOverTime: this.playsOverTime(facts),
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

  async getAgentQualityDashboard(days: number) {
    const data = await this.listAgentQualityData(days);
    const facts = this.agentQualityFacts(data.facts);
    const summary = {
      days: data.metadata.timeWindow.days,
      sessionsStarted: 0,
      sessionsStopped: 0,
      intentSelections: 0,
      nextPickRequests: 0,
      acceptedPicks: 0,
      playbackCompletions: 0,
      firstPickSkips: 0,
      firstPickOutcomes: 0,
      saves: 0,
      playlistAdds: 0,
      purchases: 0,
      purchaseUsd: 0,
      averageSessionDurationMs: null as number | null,
      acceptanceRate: 0,
      firstPickSkipRate: 0,
      completionRate: 0,
      saveRate: 0,
      playlistAddRate: 0,
      purchaseRate: 0,
    };
    const durations: number[] = [];
    const byIntent = new Map<string, AgentQualityAccumulator>();
    const byStrategy = new Map<string, AgentQualityAccumulator>();
    const byTasteSource = new Map<string, AgentQualityAccumulator>();
    const byVersion = new Map<string, AgentQualityAccumulator>();
    const byDate = new Map<string, AgentQualityTimePoint>();

    for (const fact of facts) {
      const eventName = this.stringDimension(fact.dimensions, "eventName");
      const count = fact.count || 1;
      const dateRow = byDate.get(fact.occurredDate) ?? {
        date: fact.occurredDate,
        sessionsStarted: 0,
        nextPickRequests: 0,
        acceptedPicks: 0,
        completions: 0,
        saves: 0,
        purchases: 0,
      };
      const metric = this.agentQualityMetric(fact);
      this.applyAgentQualityMetric(summary, dateRow, metric, count, fact);

      const durationMs = this.numberDimension(fact.dimensions, "sessionDurationMs");
      if (eventName === "agent.session_stopped" && durationMs !== undefined) {
        durations.push(durationMs);
      }

      this.applyAccumulatorMetric(
        this.accumulatorFor(byIntent, this.intentKey(fact), this.intentLabel(fact)),
        metric,
        count,
        fact,
      );
      this.applyAccumulatorMetric(
        this.accumulatorFor(byStrategy, this.strategyKey(fact), this.strategyLabel(fact)),
        metric,
        count,
        fact,
      );
      this.applyAccumulatorMetric(
        this.accumulatorFor(byTasteSource, this.tasteSourceKey(fact), this.tasteSourceLabel(fact)),
        metric,
        count,
        fact,
      );
      this.applyAccumulatorMetric(
        this.accumulatorFor(byVersion, this.versionKey(fact), this.versionLabel(fact)),
        metric,
        count,
        fact,
      );

      byDate.set(fact.occurredDate, dateRow);
    }

    summary.averageSessionDurationMs = averageOrNull(durations);
    summary.acceptanceRate = ratio(summary.acceptedPicks, summary.nextPickRequests);
    summary.firstPickSkipRate = ratio(summary.firstPickSkips, summary.firstPickOutcomes);
    summary.completionRate = ratio(summary.playbackCompletions, summary.acceptedPicks);
    summary.saveRate = ratio(summary.saves, summary.acceptedPicks);
    summary.playlistAddRate = ratio(summary.playlistAdds, summary.acceptedPicks);
    summary.purchaseRate = ratio(summary.purchases, summary.acceptedPicks);

    return {
      summary,
      intentBreakdown: this.finalizeBreakdowns(byIntent),
      strategyBreakdown: this.finalizeBreakdowns(byStrategy),
      tasteSourceBreakdown: this.finalizeBreakdowns(byTasteSource),
      versionBreakdown: this.finalizeBreakdowns(byVersion),
      qualityOverTime: [...byDate.values()].sort((left, right) => left.date.localeCompare(right.date)),
      privacy: {
        aggregation: "event-level aggregate metrics only",
        excludes: ["raw listener history", "actor ids", "wallet addresses", "per-user drilldowns"],
      },
      meta: data.metadata,
    };
  }

  private async listAgentQualityData(days: number): Promise<AgentQualityData> {
    const normalizedDays = this.normalizedDays(days);
    const to = new Date();
    const from = new Date(to.getTime() - normalizedDays * 24 * 60 * 60 * 1000);
    const reportResult: AgentQualityFactResult | null =
      (await this.reportSource?.listAgentQualityFacts?.({ from, to })) ?? null;
    if (reportResult) {
      return reportResult;
    }

    const exportPayload = await this.exportLayers();
    const facts = exportPayload.analyticsFacts.filter((fact) => {
      const occurredAt = new Date(fact.occurredAt).getTime();
      return occurredAt >= from.getTime() && occurredAt < to.getTime();
    });
    const qualityFacts = this.agentQualityFacts(facts);
    const freshness = this.freshnessFromFacts(qualityFacts, to);
    return {
      facts: qualityFacts,
      metadata: {
        source: "warehouse_export",
        generatedAt: exportPayload.generatedAt,
        timeWindow: timeWindowMetadata(from, to),
        freshness,
        isEmpty: qualityFacts.length === 0,
        cache: {
          hit: false,
          ttlSeconds: 0,
        },
      },
    };
  }

  private agentQualityFacts(facts: AnalyticsFactRow[]) {
    const agentSessionIds = new Set<string>();
    for (const fact of facts) {
      const eventName = this.stringDimension(fact.dimensions, "eventName");
      const sessionId = this.stringDimension(fact.dimensions, "sessionId");
      if (sessionId && eventName?.startsWith("agent.")) {
        agentSessionIds.add(sessionId);
      }
    }

    return facts.filter((fact) => {
      const eventName = this.stringDimension(fact.dimensions, "eventName");
      const source = this.stringDimension(fact.dimensions, "source") ?? "";
      const sessionId = this.stringDimension(fact.dimensions, "sessionId");
      return Boolean(
        eventName?.startsWith("agent.") ||
          source.startsWith("agent") ||
          (sessionId && agentSessionIds.has(sessionId)),
      );
    });
  }

  private agentQualityMetric(fact: AnalyticsFactRow): AgentQualityMetric {
    const eventName = this.stringDimension(fact.dimensions, "eventName");
    if (eventName === "agent.session_started") return "session_started";
    if (eventName === "agent.session_stopped") return "session_stopped";
    if (eventName === "agent.intent_selected") return "intent_selected";
    if (eventName === "agent.next_pick_requested") {
      return this.isAcceptedPickFact(fact) ? "accepted_pick" : "next_pick_requested";
    }
    if (eventName === "agent.recommendation_selected") return "accepted_pick";
    if (eventName === "playback.completed") {
      return this.isFirstPickSkipFact(fact) ? "first_pick_skip" : "playback_completed";
    }
    if (eventName === "library.saved") return "save";
    if (eventName === "playlist.track_added") return "playlist_add";
    if (
      eventName === "commerce.settled" ||
      eventName === "payment.settled" ||
      eventName === "marketplace.purchase_intent"
    ) {
      return "purchase";
    }
    return "other";
  }

  private applyAgentQualityMetric(
    summary: {
      sessionsStarted: number;
      sessionsStopped: number;
      intentSelections: number;
      nextPickRequests: number;
      acceptedPicks: number;
      playbackCompletions: number;
      firstPickSkips: number;
      firstPickOutcomes: number;
      saves: number;
      playlistAdds: number;
      purchases: number;
      purchaseUsd: number;
    },
    dateRow: AgentQualityTimePoint,
    metric: AgentQualityMetric,
    count: number,
    fact: AnalyticsFactRow,
  ) {
    if (metric === "session_started") {
      summary.sessionsStarted += count;
      dateRow.sessionsStarted += count;
    }
    if (metric === "session_stopped") {
      summary.sessionsStopped += count;
    }
    if (metric === "intent_selected") {
      summary.intentSelections += count;
    }
    if (metric === "next_pick_requested" || metric === "accepted_pick") {
      summary.nextPickRequests += count;
      dateRow.nextPickRequests += count;
    }
    if (metric === "accepted_pick") {
      summary.acceptedPicks += count;
      dateRow.acceptedPicks += count;
    }
    if (metric === "playback_completed" || metric === "first_pick_skip") {
      summary.playbackCompletions += count;
      dateRow.completions += count;
    }
    if (metric === "first_pick_skip") {
      summary.firstPickSkips += count;
      summary.firstPickOutcomes += count;
    } else if (this.isFirstPickOutcomeFact(fact)) {
      summary.firstPickOutcomes += count;
    }
    if (metric === "save") {
      summary.saves += count;
      dateRow.saves += count;
    }
    if (metric === "playlist_add") {
      summary.playlistAdds += count;
    }
    if (metric === "purchase") {
      summary.purchases += count;
      summary.purchaseUsd += this.canonicalUsdAmount(fact);
      dateRow.purchases += count;
    }
  }

  private applyAccumulatorMetric(
    acc: AgentQualityAccumulator,
    metric: AgentQualityMetric,
    count: number,
    fact: AnalyticsFactRow,
  ) {
    if (metric === "session_started") acc.sessionsStarted += count;
    if (metric === "next_pick_requested" || metric === "accepted_pick") acc.nextPickRequests += count;
    if (metric === "accepted_pick") acc.acceptedPicks += count;
    if (metric === "playback_completed" || metric === "first_pick_skip") acc.playbackCompletions += count;
    if (metric === "save") acc.saves += count;
    if (metric === "playlist_add") acc.playlistAdds += count;
    if (metric === "purchase") acc.purchases += count;
    const durationMs = this.numberDimension(fact.dimensions, "sessionDurationMs");
    if (metric === "session_stopped" && durationMs !== undefined) {
      acc.sessionDurationsMs.push(durationMs);
    }
  }

  private finalizeBreakdowns(map: Map<string, AgentQualityAccumulator>): AgentQualityBreakdown[] {
    return [...map.values()]
      .map((acc) => ({
        key: acc.key,
        label: acc.label,
        sessionsStarted: acc.sessionsStarted,
        nextPickRequests: acc.nextPickRequests,
        acceptedPicks: acc.acceptedPicks,
        acceptanceRate: ratio(acc.acceptedPicks, acc.nextPickRequests),
        completionRate: ratio(acc.playbackCompletions, acc.acceptedPicks),
        saveRate: ratio(acc.saves, acc.acceptedPicks),
        purchaseRate: ratio(acc.purchases, acc.acceptedPicks),
        averageSessionDurationMs: averageOrNull(acc.sessionDurationsMs),
      }))
      .filter(
        (row) =>
          row.sessionsStarted > 0 ||
          row.nextPickRequests > 0 ||
          row.acceptedPicks > 0 ||
          row.completionRate > 0 ||
          row.saveRate > 0 ||
          row.purchaseRate > 0 ||
          row.averageSessionDurationMs !== null,
      )
      .sort(
        (left, right) =>
          right.nextPickRequests - left.nextPickRequests ||
          right.sessionsStarted - left.sessionsStarted ||
          left.label.localeCompare(right.label),
      )
      .slice(0, 20);
  }

  private accumulatorFor(map: Map<string, AgentQualityAccumulator>, key: string, label: string) {
    const existing = map.get(key);
    if (existing) {
      return existing;
    }
    const acc: AgentQualityAccumulator = {
      key,
      label,
      sessionsStarted: 0,
      nextPickRequests: 0,
      acceptedPicks: 0,
      playbackCompletions: 0,
      saves: 0,
      playlistAdds: 0,
      purchases: 0,
      sessionDurationsMs: [],
    };
    map.set(key, acc);
    return acc;
  }

  private isAcceptedPickFact(fact: AnalyticsFactRow) {
    const status = this.stringDimension(fact.dimensions, "status");
    const trackId = this.stringDimension(fact.dimensions, "trackId") ?? fact.trackId;
    return status === "ok" && Boolean(trackId);
  }

  private isFirstPickSkipFact(fact: AnalyticsFactRow) {
    const completionRatio = this.numberDimension(fact.dimensions, "completionRatio");
    return this.isFirstPickOutcomeFact(fact) && completionRatio !== undefined && completionRatio < 0.3;
  }

  private isFirstPickOutcomeFact(fact: AnalyticsFactRow) {
    const firstPick = fact.dimensions.firstPick;
    const queueIndex = this.numberDimension(fact.dimensions, "queueIndex");
    return firstPick === true || queueIndex === 0;
  }

  private intentKey(fact: AnalyticsFactRow) {
    return this.stringDimension(fact.dimensions, "intent") ?? "unattributed";
  }

  private intentLabel(fact: AnalyticsFactRow) {
    return this.stringDimension(fact.dimensions, "intentName") ?? titleLabel(this.intentKey(fact));
  }

  private strategyKey(fact: AnalyticsFactRow) {
    return this.stringDimension(fact.dimensions, "strategy") ?? this.stringDimension(fact.dimensions, "runtimeStatus") ?? "unattributed";
  }

  private strategyLabel(fact: AnalyticsFactRow) {
    return titleLabel(this.strategyKey(fact));
  }

  private tasteSourceKey(fact: AnalyticsFactRow) {
    return this.stringDimension(fact.dimensions, "tasteSignalSource") ?? "deterministic";
  }

  private tasteSourceLabel(fact: AnalyticsFactRow) {
    return titleLabel(this.tasteSourceKey(fact));
  }

  private versionKey(fact: AnalyticsFactRow) {
    return (
      this.stringDimension(fact.dimensions, "modelVersion") ??
      this.stringDimension(fact.dimensions, "materializationVersion") ??
      "unversioned"
    );
  }

  private versionLabel(fact: AnalyticsFactRow) {
    return this.versionKey(fact);
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
        new Date(`${view.date}T00:00:00.000Z`).getTime() < dailyViewExclusiveEndDate(to).getTime(),
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
          managerArtistId: this.stringDimension(fact.dimensions, "managerArtistId") ?? catalogTrack.managerArtistId,
          managerArtistName: this.stringDimension(fact.dimensions, "managerArtistName") ?? catalogTrack.managerArtistName ?? undefined,
          creditedArtistId: this.stringDimension(fact.dimensions, "creditedArtistId") ?? catalogTrack.creditedArtistId ?? undefined,
          creditedArtistName: this.stringDimension(fact.dimensions, "creditedArtistName") ?? catalogTrack.creditedArtistName ?? undefined,
          creditedArtistIds: this.arrayDimension(fact.dimensions, "creditedArtistIds") ?? catalogTrack.creditedArtistIds,
          creditedArtistNames: this.arrayDimension(fact.dimensions, "creditedArtistNames") ?? catalogTrack.creditedArtistNames,
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

  private playsOverTime(facts: AnalyticsFactRow[]): PlaysOverTimeStats[] {
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

  private arrayDimension(dimensions: Record<string, unknown>, key: string) {
    const value = dimensions[key];
    return Array.isArray(value) && value.every((entry) => typeof entry === "string")
      ? value
      : undefined;
  }

  private numberDimension(dimensions: Record<string, unknown>, key: string) {
    const value = dimensions[key];
    return typeof value === "number" && Number.isFinite(value) ? value : undefined;
  }
}

function startOfUtcDate(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function dailyViewExclusiveEndDate(value: Date) {
  const start = startOfUtcDate(value);
  return value.getTime() === start.getTime() ? start : new Date(start.getTime() + 24 * 60 * 60 * 1000);
}

function ratio(numerator: number, denominator: number) {
  if (denominator <= 0) {
    return 0;
  }
  return Number((numerator / denominator).toFixed(4));
}

function averageOrNull(values: number[]) {
  if (values.length === 0) {
    return null;
  }
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

function titleLabel(value: string) {
  if (value === "unattributed") {
    return "Unattributed";
  }
  if (value === "unversioned") {
    return "Unversioned";
  }
  return value
    .split(/[_-]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
