import { Injectable, Optional } from "@nestjs/common";
import { AnalyticsIngestService } from "./analytics_ingest.service";
import {
  AnalyticsFactRow,
  AnalyticsWarehouseExport,
  AnalyticsWarehouseExportService,
  buildAnalyticsWarehouseExport,
} from "./analytics_warehouse";

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

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly ingestService: AnalyticsIngestService,
    @Optional() private readonly warehouseExportService?: AnalyticsWarehouseExportService,
  ) {}

  async getArtistStats(artistId: string, days: number) {
    const facts = await this.listArtistFacts(artistId, days);

    const summary = {
      artistId,
      days,
      totalPlays: 0,
      totalPayoutUsd: 0,
    };
    const tracks: TrackStats[] = [];
    const trackMap = new Map<string, TrackStats>();

    facts.forEach((fact) => {
      const dimensions = fact.dimensions;
      const eventName = this.stringDimension(dimensions, "eventName");
      const trackId = fact.trackId ?? "unknown";
      const title = this.stringDimension(dimensions, "title") ?? "Unknown Track";
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
    return { summary: { ...summary, payoutsByAsset: this.aggregateAssetPayouts(tracks.flatMap((track) => track.payoutsByAsset)) }, tracks };
  }

  async getArtistDashboard(artistId: string, days: number) {
    const facts = await this.listArtistFacts(artistId, days);

    const summary = {
      artistId,
      days,
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
      const title = this.stringDimension(dimensions, "title") ?? "Unknown Track";
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
      days,
      totalPlays: summary.totalPlays,
      totalPayoutUsd: summary.totalPayoutUsd,
      payoutsByAsset: this.aggregateAssetPayouts(
        [...trackMap.values()].flatMap((track) => track.payoutsByAsset),
      ),
      generatedAt: new Date().toISOString(),
    };

    return {
      summary: {
        ...summary,
        payoutsByAsset: exportPayload.payoutsByAsset,
      },
      tracks: [...trackMap.values()],
      sessions: [...sessionMap.values()],
      sources: [...sourceMap.values()],
      export: exportPayload,
    };
  }

  private async listArtistFacts(artistId: string, days: number) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const exportPayload = await this.exportLayers();
    return exportPayload.analyticsFacts.filter(
      (fact) => fact.artistId === artistId && new Date(fact.occurredAt).getTime() >= since,
    );
  }

  private async exportLayers(): Promise<AnalyticsWarehouseExport> {
    if (this.warehouseExportService) {
      return this.warehouseExportService.exportLayers();
    }
    return buildAnalyticsWarehouseExport(await this.ingestService.listEvents());
  }

  private isPlayEvent(eventName?: string) {
    return eventName === "license.granted" || eventName === "playback.completed";
  }

  private isPayoutEvent(eventName?: string) {
    return eventName === "payment.settled" || eventName === "commerce.settled";
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
