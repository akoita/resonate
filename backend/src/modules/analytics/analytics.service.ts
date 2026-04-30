import { Injectable } from "@nestjs/common";
import { AnalyticsIngestService } from "./analytics_ingest.service";

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
  constructor(private readonly ingestService: AnalyticsIngestService) {}

  getArtistStats(artistId: string, days: number) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const events = this.ingestService
      .listEvents()
      .filter((event) => new Date(event.occurredAt).getTime() >= since);
    const filtered = events.filter((event) => {
      const payload = event.payload as Record<string, unknown>;
      return payload.artistId === artistId;
    });

    const summary = {
      artistId,
      days,
      totalPlays: 0,
      totalPayoutUsd: 0,
    };
    const tracks: TrackStats[] = [];
    const trackMap = new Map<string, TrackStats>();

    filtered.forEach((event) => {
      const payload = event.payload as Record<string, any>;
      const trackId = payload.trackId ?? "unknown";
      const title = payload.title ?? "Unknown Track";
      const stats =
        trackMap.get(trackId) ?? { trackId, title, plays: 0, payoutUsd: 0, payoutsByAsset: [] };
      if (event.eventName === "license.granted") {
        stats.plays += 1;
        summary.totalPlays += 1;
      }
      if (event.eventName === "payment.settled") {
        const amount = this.canonicalUsdAmount(payload);
        stats.payoutUsd += amount;
        stats.payoutsByAsset = this.addAssetPayout(stats.payoutsByAsset, payload, amount);
        summary.totalPayoutUsd += amount;
      }
      trackMap.set(trackId, stats);
    });

    tracks.push(...trackMap.values());
    return { summary: { ...summary, payoutsByAsset: this.aggregateAssetPayouts(tracks.flatMap((track) => track.payoutsByAsset)) }, tracks };
  }

  getArtistDashboard(artistId: string, days: number) {
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    const events = this.ingestService
      .listEvents()
      .filter((event) => new Date(event.occurredAt).getTime() >= since);
    const filtered = events.filter((event) => {
      const payload = event.payload as Record<string, unknown>;
      return payload.artistId === artistId;
    });

    const summary = {
      artistId,
      days,
      totalPlays: 0,
      totalPayoutUsd: 0,
    };
    const trackMap = new Map<string, TrackStats>();
    const sessionMap = new Map<string, SessionStats>();
    const sourceMap = new Map<string, SourceStats>();

    filtered.forEach((event) => {
      const payload = event.payload as Record<string, any>;
      const trackId = payload.trackId ?? "unknown";
      const title = payload.title ?? "Unknown Track";
      const sessionId = payload.sessionId ?? "unknown";
      const source = payload.source ?? "unknown";

      const trackStats =
        trackMap.get(trackId) ?? { trackId, title, plays: 0, payoutUsd: 0, payoutsByAsset: [] };
      const sessionStats =
        sessionMap.get(sessionId) ?? { sessionId, plays: 0, payoutUsd: 0, payoutsByAsset: [] };
      const sourceStats = sourceMap.get(source) ?? { source, plays: 0 };

      if (event.eventName === "license.granted") {
        trackStats.plays += 1;
        sessionStats.plays += 1;
        sourceStats.plays += 1;
        summary.totalPlays += 1;
      }
      if (event.eventName === "payment.settled") {
        const amount = this.canonicalUsdAmount(payload);
        trackStats.payoutUsd += amount;
        sessionStats.payoutUsd += amount;
        trackStats.payoutsByAsset = this.addAssetPayout(trackStats.payoutsByAsset, payload, amount);
        sessionStats.payoutsByAsset = this.addAssetPayout(sessionStats.payoutsByAsset, payload, amount);
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

  private canonicalUsdAmount(payload: Record<string, any>) {
    return Number(payload.canonicalAmountUsd ?? payload.amountUsd ?? 0);
  }

  private addAssetPayout(
    payouts: AssetPayoutStats[],
    payload: Record<string, any>,
    canonicalAmountUsd: number,
  ): AssetPayoutStats[] {
    return this.aggregateAssetPayouts([
      ...payouts,
      {
        paymentToken: payload.paymentToken ?? "0x0000000000000000000000000000000000000000",
        assetId: payload.paymentAssetId ?? null,
        symbol: payload.paymentAssetSymbol ?? payload.currency ?? "USD",
        decimals: Number(payload.paymentAssetDecimals ?? 2),
        settlementAmount: String(payload.settlementAmount ?? payload.amount ?? payload.amountUsd ?? "0"),
        settlementAmountUnits: String(payload.settlementAmountUnits ?? payload.amountUnits ?? "0"),
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
}
