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

type ArtistActionCardType =
  | "promote_top_track"
  | "review_marketplace_readiness"
  | "start_listener_community"
  | "prepare_marketplace_catalog"
  | "review_show_city_demand"
  | "post_campaign_update"
  | "create_holder_benefit"
  | "invite_holder_collectors"
  | "reward_early_supporters"
  | "prepare_remix_challenge"
  | "review_remix_supply_pricing"
  | "triage_fan_questions"
  | "relist_expired_inventory"
  | "improve_marketplace_conversion"
  | "review_marketplace_pricing";
type ArtistActionPriority = "high" | "medium" | "low";
type ArtistActionSourceCategory = "playback" | "marketplace" | "community" | "catalog" | "shows" | "remix";

interface ArtistActionCard {
  id: string;
  type: ArtistActionCardType;
  title: string;
  description: string;
  reason: string;
  priority: ArtistActionPriority;
  confidence: number;
  sourceSignal: {
    category: ArtistActionSourceCategory;
    summary: string;
    count?: number;
  };
  cta: {
    label: string;
    href?: string;
    disabled?: boolean;
    disabledReason?: string;
  };
  privacy: {
    aggregateOnly: true;
    thresholdApplied: boolean;
    minimumThreshold?: number;
  };
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

interface ArtistCityDemandSignal {
  campaignId: string;
  campaignSlug?: string;
  city?: string;
  country?: string;
  count: number;
}

interface ArtistCampaignUpdateSignal {
  campaignId: string;
  campaignSlug?: string;
  count: number;
}

interface ArtistSupporterRewardSignal {
  campaignId?: string;
  campaignSlug?: string;
  source: "supporter_roles" | "supporter_room_joins";
  count: number;
}

interface ArtistWorkflowSignals {
  topCityDemand?: ArtistCityDemandSignal;
  topCampaignUpdate?: ArtistCampaignUpdateSignal;
  holderRoomJoins: number;
  benefitRuleCreations: number;
  earlySupporterReward?: ArtistSupporterRewardSignal;
  /**
   * Remix Studio drafts created from this artist's tracks
   * (remix.project_created) plus legacy minted-remix events (remix.created),
   * so pre-studio aggregates keep counting (#1121).
   */
  remixCreations: number;
  remixDemandSignals: number;
  communityFanMessages: number;
  communityArtistMessages: number;
  marketplacePurchaseIntents: number;
  artistSettledCommerceCount: number;
  marketplaceInventory: {
    seen: boolean;
    relistableCount: number;
    expiredCount: number;
    expiringSoonCount: number;
    activeCount: number;
    totalListings: number;
  };
}

@Injectable()
export class AnalyticsService {
  private readonly artistActionMinimumSignalCount = 5;
  // Aggregate-signal floor above which a marketplace action card is treated as
  // high priority/confidence rather than the default medium.
  private readonly artistActionHighIntentSignalCount = 25;

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
    const topTracks = this.topTracks(tracks);
    const protection = this.protectionMetrics(facts);

    return {
      summary: {
        ...summary,
        payoutsByAsset: exportPayload.payoutsByAsset,
      },
      tracks,
      topTracks,
      sessions: [...sessionMap.values()],
      sources: [...sourceMap.values()],
      playsOverTime: this.playsOverTime(facts),
      trackPerformance: tracks,
      protection,
      actions: this.artistActionCards({
        artistId,
        totalPlays: summary.totalPlays,
        topTracks,
        protection,
        workflowSignals: this.artistWorkflowSignals(facts),
        days: data.metadata.timeWindow.days,
      }),
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

  private artistActionCards(input: {
    artistId: string;
    totalPlays: number;
    topTracks: TrackStats[];
    protection: ProtectionMetrics;
    workflowSignals: ArtistWorkflowSignals;
    days: number;
  }): ArtistActionCard[] {
    const cards: ArtistActionCard[] = [];
    const topTrack = input.topTracks[0];
    const hasListenerSignal = input.totalPlays >= this.artistActionMinimumSignalCount;

    if (topTrack && topTrack.plays >= this.artistActionMinimumSignalCount) {
      cards.push({
        id: `promote_top_track:${topTrack.trackId}`,
        type: "promote_top_track",
        title: "Promote the track listeners already choose",
        description: `${topTrack.title} is your strongest recent playback signal.`,
        reason: `${topTrack.plays} aggregate plays in the last ${input.days} days.`,
        priority: topTrack.plays >= 25 ? "high" : "medium",
        confidence: topTrack.plays >= 25 ? 0.82 : 0.68,
        sourceSignal: {
          category: "playback",
          summary: "Top track by aggregate plays",
          count: topTrack.plays,
        },
        cta: {
          label: "Open in player",
          href: `/player?trackId=${encodeURIComponent(topTrack.trackId)}`,
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    if (input.protection.marketplaceReadyReleases > 0) {
      cards.push({
        id: "review_marketplace_readiness",
        type: "review_marketplace_readiness",
        title: "Review marketplace-ready catalog",
        description: "Protected releases are cleared for marketplace listing workflows.",
        reason: `${input.protection.marketplaceReadyReleases} release${input.protection.marketplaceReadyReleases === 1 ? "" : "s"} are marketplace-ready.`,
        priority: "medium",
        confidence: 0.74,
        sourceSignal: {
          category: "marketplace",
          summary: "Marketplace-ready protection route",
          count: input.protection.marketplaceReadyReleases,
        },
        cta: {
          label: "Manage listings",
          href: "/marketplace/manage",
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: false,
        },
      });
    } else {
      cards.push({
        id: "prepare_marketplace_catalog",
        type: "prepare_marketplace_catalog",
        title: "Prepare catalog for marketplace listings",
        description: "No releases are marketplace-ready in the current analytics window.",
        reason: "Rights routing must approve releases before listing recommendations can point to the marketplace.",
        priority: "low",
        confidence: 0.52,
        sourceSignal: {
          category: "catalog",
          summary: "No marketplace-ready releases detected",
        },
        cta: {
          label: "Review catalog",
          href: "/artist/catalog",
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: false,
        },
      });
    }

    if (hasListenerSignal) {
      cards.push({
        id: "start_listener_community",
        type: "start_listener_community",
        title: "Gather listeners in your community room",
        description: "Recent listener activity is high enough to make a public artist room useful.",
        reason: `${input.totalPlays} aggregate plays in the last ${input.days} days.`,
        priority: input.totalPlays >= 25 ? "high" : "medium",
        confidence: input.totalPlays >= 25 ? 0.8 : 0.64,
        sourceSignal: {
          category: "community",
          summary: "Aggregate playback demand",
          count: input.totalPlays,
        },
        cta: {
          label: "Open community",
          href: `/artist/${encodeURIComponent(input.artistId)}?tab=community`,
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    const cityDemand = input.workflowSignals.topCityDemand;
    if (cityDemand && cityDemand.count >= this.artistActionMinimumSignalCount) {
      const cityLabel = [cityDemand.city, cityDemand.country].filter(Boolean).join(", ") || "a campaign city";
      cards.push({
        id: `review_show_city_demand:${cityDemand.campaignId}`,
        type: "review_show_city_demand",
        title: "Review city demand for a show campaign",
        description: `${cityLabel} has enough aggregate supporter interest to revisit the campaign plan.`,
        reason: `${cityDemand.count} aggregate city-interest joins in the last ${input.days} days.`,
        priority: cityDemand.count >= 25 ? "high" : "medium",
        confidence: cityDemand.count >= 25 ? 0.8 : 0.66,
        sourceSignal: {
          category: "shows",
          summary: "Show city-demand joins",
          count: cityDemand.count,
        },
        cta: {
          label: "Open campaign",
          href: `/shows/${encodeURIComponent(cityDemand.campaignSlug ?? cityDemand.campaignId)}`,
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    const campaignUpdate = input.workflowSignals.topCampaignUpdate;
    if (campaignUpdate && campaignUpdate.count >= this.artistActionMinimumSignalCount) {
      cards.push({
        id: `post_campaign_update:${campaignUpdate.campaignId}`,
        type: "post_campaign_update",
        title: "Post a campaign update",
        description: "Supporters are reading campaign updates; keep the room warm with a new note.",
        reason: `${campaignUpdate.count} aggregate campaign-update views in the last ${input.days} days.`,
        priority: campaignUpdate.count >= 25 ? "high" : "medium",
        confidence: campaignUpdate.count >= 25 ? 0.78 : 0.63,
        sourceSignal: {
          category: "shows",
          summary: "Campaign update views",
          count: campaignUpdate.count,
        },
        cta: {
          label: "Open updates",
          href: `/shows/${encodeURIComponent(campaignUpdate.campaignSlug ?? campaignUpdate.campaignId)}`,
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    if (input.workflowSignals.holderRoomJoins >= this.artistActionMinimumSignalCount) {
      if (input.workflowSignals.benefitRuleCreations === 0) {
        cards.push({
          id: "create_holder_benefit",
          type: "create_holder_benefit",
          title: "Create a holder benefit",
          description: "Turn holder-room momentum into a claimable perk for eligible supporters.",
          reason: `${input.workflowSignals.holderRoomJoins} aggregate holder-room joins in the last ${input.days} days and no holder-benefit creation signal in this window.`,
          priority: input.workflowSignals.holderRoomJoins >= 25 ? "high" : "medium",
          confidence: input.workflowSignals.holderRoomJoins >= 25 ? 0.78 : 0.66,
          sourceSignal: {
            category: "community",
            summary: "Holder-room joins without recent benefit creation",
            count: input.workflowSignals.holderRoomJoins,
          },
          cta: {
            label: "Create benefit",
            href: `/artist/${encodeURIComponent(input.artistId)}?tab=community`,
          },
          privacy: {
            aggregateOnly: true,
            thresholdApplied: true,
            minimumThreshold: this.artistActionMinimumSignalCount,
          },
        });
      }

      cards.push({
        id: "invite_holder_collectors",
        type: "invite_holder_collectors",
        title: "Invite holders into the collector room",
        description: "Holder-room activity is high enough to make direct collector engagement worthwhile.",
        reason: `${input.workflowSignals.holderRoomJoins} aggregate holder-room joins in the last ${input.days} days.`,
        priority: input.workflowSignals.holderRoomJoins >= 25 ? "high" : "medium",
        confidence: input.workflowSignals.holderRoomJoins >= 25 ? 0.76 : 0.62,
        sourceSignal: {
          category: "community",
          summary: "Holder-room joins",
          count: input.workflowSignals.holderRoomJoins,
        },
        cta: {
          label: "Open holder room",
          href: `/artist/${encodeURIComponent(input.artistId)}?tab=community`,
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    const earlySupporters = input.workflowSignals.earlySupporterReward;
    if (earlySupporters && earlySupporters.count >= this.artistActionMinimumSignalCount) {
      const signalLabel =
        earlySupporters.source === "supporter_roles" ? "supporter role grants" : "supporter-room joins";
      cards.push({
        id: `reward_early_supporters:${earlySupporters.campaignId ?? earlySupporters.source}`,
        type: "reward_early_supporters",
        title: "Reward early supporters",
        description: "Supporter momentum is high enough to create or refresh a thank-you benefit.",
        reason: `${earlySupporters.count} aggregate ${signalLabel} in the last ${input.days} days.`,
        priority: earlySupporters.count >= 25 ? "high" : "medium",
        confidence: earlySupporters.count >= 25 ? 0.78 : 0.64,
        sourceSignal: {
          category: "community",
          summary:
            earlySupporters.source === "supporter_roles"
              ? "Campaign supporter role grants"
              : "Campaign supporter room joins",
          count: earlySupporters.count,
        },
        cta: {
          label: "Open benefits",
          href: `/artist/${encodeURIComponent(input.artistId)}?tab=community`,
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    if (input.workflowSignals.remixCreations >= this.artistActionMinimumSignalCount) {
      // Prepare-scoped guidance (#1121): remixers are drafting from this
      // artist's stems, so route the artist to verify remix supply — stems
      // minted remixable and remix-tier licenses listed. A true
      // "launch remix challenge" action stays deferred until artist opt-in
      // settings (remix backlog A1) and a challenge surface exist.
      cards.push({
        id: "prepare_remix_challenge",
        type: "prepare_remix_challenge",
        title: "Prepare a remix challenge brief",
        description:
          "Remixers are creating Remix Studio drafts from your stems. Verify remix supply — remixable mints and listed remix-tier licenses — before drafting a challenge.",
        reason: `${input.workflowSignals.remixCreations} aggregate remix drafts and creations in the last ${input.days} days.`,
        priority: input.workflowSignals.remixCreations >= 25 ? "high" : "medium",
        confidence: input.workflowSignals.remixCreations >= 25 ? 0.74 : 0.6,
        sourceSignal: {
          category: "remix",
          summary: "Remix Studio drafts and remix creations",
          count: input.workflowSignals.remixCreations,
        },
        cta: {
          label: "Review remix supply",
          href: "/marketplace/manage?status=active",
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    if (
      input.workflowSignals.remixDemandSignals >= this.artistActionMinimumSignalCount &&
      input.workflowSignals.marketplaceInventory.seen &&
      input.workflowSignals.marketplaceInventory.activeCount === 0
    ) {
      cards.push({
        id: "review_remix_supply_pricing",
        type: "review_remix_supply_pricing",
        title: "Review remix supply pricing",
        description:
          "Remix demand is visible, but your seller workspace has no active marketplace inventory in this analytics window.",
        reason: `${input.workflowSignals.remixDemandSignals} aggregate remix demand signals and no active owner inventory in the last ${input.days} days.`,
        priority:
          input.workflowSignals.remixDemandSignals >= this.artistActionHighIntentSignalCount ? "high" : "medium",
        confidence:
          input.workflowSignals.remixDemandSignals >= this.artistActionHighIntentSignalCount ? 0.8 : 0.66,
        sourceSignal: {
          category: "remix",
          summary: "Remix demand with no active owner inventory",
          count: input.workflowSignals.remixDemandSignals,
        },
        cta: {
          label: "Review active listings",
          href: "/marketplace/manage?status=active",
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    if (
      input.workflowSignals.communityFanMessages >= this.artistActionMinimumSignalCount &&
      input.workflowSignals.communityArtistMessages === 0
    ) {
      cards.push({
        id: "triage_fan_questions",
        type: "triage_fan_questions",
        title: "Triage fan questions",
        description: "Fans are posting in your community rooms without a recent announcement or campaign update signal.",
        reason: `${input.workflowSignals.communityFanMessages} aggregate fan messages and no recent artist update signal in the last ${input.days} days.`,
        priority:
          input.workflowSignals.communityFanMessages >= this.artistActionHighIntentSignalCount ? "high" : "medium",
        confidence:
          input.workflowSignals.communityFanMessages >= this.artistActionHighIntentSignalCount ? 0.78 : 0.64,
        sourceSignal: {
          category: "community",
          summary: "Fan messages without recent artist updates",
          count: input.workflowSignals.communityFanMessages,
        },
        cta: {
          label: "Open community",
          href: `/artist/${encodeURIComponent(input.artistId)}?tab=community`,
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    if (input.workflowSignals.marketplaceInventory.relistableCount > 0) {
      const relistableCount = input.workflowSignals.marketplaceInventory.relistableCount;
      cards.push({
        id: "relist_expired_inventory",
        type: "relist_expired_inventory",
        title: "Relist expired marketplace inventory",
        description: "Expired or cancelled listings are ready for the existing relist workflow.",
        reason: `${relistableCount} listing${relistableCount === 1 ? "" : "s"} can be relisted from your seller workspace.`,
        priority: relistableCount >= 5 ? "high" : "medium",
        confidence: relistableCount >= 5 ? 0.82 : 0.7,
        sourceSignal: {
          category: "marketplace",
          summary: "Relistable owner inventory",
          count: relistableCount,
        },
        cta: {
          label: "Open expired listings",
          href: "/marketplace/manage?status=expired",
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: false,
        },
      });
    }

    if (
      input.workflowSignals.marketplacePurchaseIntents >= this.artistActionMinimumSignalCount &&
      input.workflowSignals.artistSettledCommerceCount === 0
    ) {
      cards.push({
        id: "improve_marketplace_conversion",
        type: "improve_marketplace_conversion",
        title: "Improve marketplace checkout conversion",
        description: "Buyers are starting checkout, but no settled commerce is visible in this analytics window.",
        reason: `${input.workflowSignals.marketplacePurchaseIntents} aggregate purchase intents and no settled commerce in the last ${input.days} days.`,
        priority:
          input.workflowSignals.marketplacePurchaseIntents >= this.artistActionHighIntentSignalCount ? "high" : "medium",
        confidence:
          input.workflowSignals.marketplacePurchaseIntents >= this.artistActionHighIntentSignalCount ? 0.8 : 0.68,
        sourceSignal: {
          category: "marketplace",
          summary: "Purchase intent without settled commerce",
          count: input.workflowSignals.marketplacePurchaseIntents,
        },
        cta: {
          label: "Review active listings",
          href: "/marketplace/manage?status=active",
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    } else if (input.workflowSignals.marketplacePurchaseIntents >= this.artistActionMinimumSignalCount) {
      cards.push({
        id: "review_marketplace_pricing",
        type: "review_marketplace_pricing",
        title: "Review marketplace pricing",
        description: "Checkout intent is high enough to revisit price, license tier coverage, or promotion timing.",
        reason: `${input.workflowSignals.marketplacePurchaseIntents} aggregate purchase intents in the last ${input.days} days.`,
        priority:
          input.workflowSignals.marketplacePurchaseIntents >= this.artistActionHighIntentSignalCount ? "high" : "medium",
        confidence:
          input.workflowSignals.marketplacePurchaseIntents >= this.artistActionHighIntentSignalCount ? 0.78 : 0.64,
        sourceSignal: {
          category: "marketplace",
          summary: "Marketplace purchase intent",
          count: input.workflowSignals.marketplacePurchaseIntents,
        },
        cta: {
          label: "Manage active listings",
          href: "/marketplace/manage?status=active",
        },
        privacy: {
          aggregateOnly: true,
          thresholdApplied: true,
          minimumThreshold: this.artistActionMinimumSignalCount,
        },
      });
    }

    return cards.sort((left, right) => priorityRank(right.priority) - priorityRank(left.priority)).slice(0, 8);
  }

  private artistWorkflowSignals(facts: AnalyticsFactRow[]): ArtistWorkflowSignals {
    const cityDemandByCampaign = new Map<string, ArtistCityDemandSignal>();
    const updateViewsByCampaign = new Map<string, ArtistCampaignUpdateSignal>();
    const supporterRolesByCampaign = new Map<string, ArtistSupporterRewardSignal>();
    const supporterRoomJoinsByCampaign = new Map<string, ArtistSupporterRewardSignal>();
    let holderRoomJoins = 0;
    let benefitRuleCreations = 0;
    let remixCreations = 0;
    let communityFanMessages = 0;
    let communityArtistMessages = 0;
    let marketplacePurchaseIntents = 0;
    let artistSettledCommerceCount = 0;
    const marketplaceInventory = {
      seen: false,
      relistableCount: 0,
      expiredCount: 0,
      expiringSoonCount: 0,
      activeCount: 0,
      totalListings: 0,
    };

    for (const fact of facts) {
      const eventName = this.stringDimension(fact.dimensions, "eventName");
      if (eventName === "community.show_city_interest_joined") {
        const campaignId =
          this.stringDimension(fact.dimensions, "campaignId") ??
          (fact.subjectType === "show_campaign" ? fact.subjectId : undefined);
        if (campaignId) {
          const existing = cityDemandByCampaign.get(campaignId) ?? {
            campaignId,
            campaignSlug: this.stringDimension(fact.dimensions, "campaignSlug"),
            city: this.stringDimension(fact.dimensions, "city"),
            country: this.stringDimension(fact.dimensions, "country"),
            count: 0,
          };
          existing.count += fact.count;
          cityDemandByCampaign.set(campaignId, existing);
        }
      }

      if (eventName === "community.campaign_update_viewed") {
        const campaignId =
          this.stringDimension(fact.dimensions, "campaignId") ??
          (fact.subjectType === "show_campaign" ? fact.subjectId : undefined);
        if (campaignId) {
          const existing = updateViewsByCampaign.get(campaignId) ?? {
            campaignId,
            campaignSlug: this.stringDimension(fact.dimensions, "campaignSlug"),
            count: 0,
          };
          existing.count += fact.count;
          updateViewsByCampaign.set(campaignId, existing);
        }
      }

      if (
        eventName === "community.room_joined" &&
        this.stringDimension(fact.dimensions, "roomType") === "artist_holder"
      ) {
        holderRoomJoins += fact.count;
      }

      if (eventName === "community.benefit_rule_created") {
        benefitRuleCreations += fact.count;
      }

      if (
        eventName === "community.role_granted" &&
        this.stringDimension(fact.dimensions, "roleType") === "supporter"
      ) {
        const campaignId =
          this.stringDimension(fact.dimensions, "campaignId") ??
          (this.stringDimension(fact.dimensions, "scopeType") === "show_campaign"
            ? this.stringDimension(fact.dimensions, "scopeId")
            : undefined);
        const key = campaignId ?? "unknown";
        const existing = supporterRolesByCampaign.get(key) ?? {
          campaignId,
          source: "supporter_roles" as const,
          count: 0,
        };
        existing.count += fact.count;
        supporterRolesByCampaign.set(key, existing);
      }

      if (
        eventName === "community.campaign_room_joined" &&
        this.stringDimension(fact.dimensions, "roomType") === "show_campaign_supporter"
      ) {
        const campaignId =
          this.stringDimension(fact.dimensions, "campaignId") ??
          (fact.subjectType === "show_campaign" ? fact.subjectId : undefined);
        const key = campaignId ?? "unknown";
        const existing = supporterRoomJoinsByCampaign.get(key) ?? {
          campaignId,
          campaignSlug: this.stringDimension(fact.dimensions, "campaignSlug"),
          source: "supporter_room_joins" as const,
          count: 0,
        };
        existing.count += fact.count;
        supporterRoomJoinsByCampaign.set(key, existing);
      }

      if (eventName === "remix.created" || eventName === "remix.project_created") {
        // Artist-owner drafts (#1174) are the artist remixing their own
        // material — real studio activity, but not buyer demand for the
        // prepare_remix_challenge card.
        if (fact.dimensions["creatorOwner"] !== true) {
          remixCreations += fact.count;
        }
      }

      if (eventName === "community.message_created") {
        const messageType = this.stringDimension(fact.dimensions, "messageType") ?? "message";
        if (messageType === "announcement" || messageType === "campaign_update") {
          communityArtistMessages += fact.count;
        } else {
          communityFanMessages += fact.count;
        }
      }

      if (eventName === "marketplace.purchase_intent") {
        marketplacePurchaseIntents += fact.count;
      }

      // Count any artist-attributed settlement, not just marketplace stem sales:
      // if the artist is settling commerce at all, the "improve conversion" card
      // should not claim a total checkout-conversion gap. Production settlements are
      // emitted as `payment.settled` (payments-service -> domain event bridge);
      // `commerce.settled` is the alternate name handled across analytics. Gating on
      // only one name would let the conversion card fire for artists who are settling.
      if (this.isPayoutEvent(eventName)) {
        artistSettledCommerceCount += fact.count;
      }

      if (eventName === "marketplace.owner_inventory_viewed") {
        marketplaceInventory.seen = true;
        marketplaceInventory.relistableCount = Math.max(
          marketplaceInventory.relistableCount,
          this.numberDimension(fact.dimensions, "relistableCount") ?? 0,
        );
        marketplaceInventory.expiredCount = Math.max(
          marketplaceInventory.expiredCount,
          this.numberDimension(fact.dimensions, "expiredCount") ?? 0,
        );
        marketplaceInventory.expiringSoonCount = Math.max(
          marketplaceInventory.expiringSoonCount,
          this.numberDimension(fact.dimensions, "expiringSoonCount") ?? 0,
        );
        marketplaceInventory.activeCount = Math.max(
          marketplaceInventory.activeCount,
          this.numberDimension(fact.dimensions, "activeCount") ?? 0,
        );
        marketplaceInventory.totalListings = Math.max(
          marketplaceInventory.totalListings,
          this.numberDimension(fact.dimensions, "totalListings") ?? 0,
        );
      }
    }

    return {
      topCityDemand: topSignal(cityDemandByCampaign),
      topCampaignUpdate: topSignal(updateViewsByCampaign),
      holderRoomJoins,
      benefitRuleCreations,
      earlySupporterReward: topSignal(supporterRolesByCampaign) ?? topSignal(supporterRoomJoinsByCampaign),
      remixCreations,
      // Server-attributed signals only (#1168 review): remix.cta_* product
      // events carry no artistId by design (compact payloads, #1160), so in
      // production they aggregate under "unknown" — counting them here would
      // be silent dead weight, and client-supplied artistId would be a
      // client-trusted claim. Drafts are the trustworthy demand signal.
      remixDemandSignals: remixCreations,
      communityFanMessages,
      communityArtistMessages,
      marketplacePurchaseIntents,
      artistSettledCommerceCount,
      marketplaceInventory,
    };
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

function priorityRank(priority: ArtistActionPriority) {
  if (priority === "high") return 3;
  if (priority === "medium") return 2;
  return 1;
}

function topSignal<T extends { count: number; campaignId?: string }>(signals: Map<string, T>) {
  return [...signals.values()].sort(
    (left, right) => right.count - left.count || (left.campaignId ?? "").localeCompare(right.campaignId ?? ""),
  )[0];
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
