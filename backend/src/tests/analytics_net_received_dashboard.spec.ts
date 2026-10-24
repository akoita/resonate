/**
 * #2172: the artist dashboard carries `netReceived` beside the gross settled
 * figure, and degrades without taking the dashboard down.
 */
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsService } from "../modules/analytics/analytics.service";
import {
  buildArtistNetReceived,
  type ArtistNetReceivedSource,
} from "../modules/analytics/analytics_net_received";

function recentIso() {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - 1);
  date.setUTCHours(8, 0, 0, 0);
  return date.toISOString();
}

async function ingestGrossSale(ingest: AnalyticsIngestService, artistId: string) {
  await ingest.ingest({
    eventName: "commerce.settled",
    occurredAt: recentIso(),
    payload: {
      artistId,
      trackId: "track-net",
      title: "Net Track",
      amountUsd: 10,
      canonicalAmountUsd: 10,
      paymentToken: "0x1111111111111111111111111111111111111111",
      paymentAssetId: "local:usdc",
      paymentAssetSymbol: "USDC",
      paymentAssetDecimals: 6,
      settlementAmount: "10",
      settlementAmountUnits: "10000000",
    },
  });
}

function serviceWith(ingest: AnalyticsIngestService, source?: ArtistNetReceivedSource) {
  return new AnalyticsService(ingest, undefined, undefined, undefined, undefined, undefined, undefined, undefined, source);
}

describe("artist dashboard net received (#2172)", () => {
  it("returns the net beside the gross, for the dashboard's own window", async () => {
    const ingest = new AnalyticsIngestService();
    await ingestGrossSale(ingest, "artist-net-1");
    const calls: Array<{ artistId: string; from: Date; to: Date }> = [];
    const source: ArtistNetReceivedSource = {
      async getArtistNetReceived(input) {
        calls.push(input);
        return {
          status: "ready",
          ...buildArtistNetReceived(
            [
              {
                settlementKey: "k1",
                purchasedAt: new Date(),
                trackId: "track-net",
                trackTitle: "Net Track",
                paymentToken: "0x1111111111111111111111111111111111111111",
                paymentAssetId: "local:usdc",
                symbol: "USDC",
                decimals: 6,
                pricingStrategy: "usd_pegged",
                totalPaid: "10000000",
                sellerAddress: "0x" + "a".repeat(40),
                royaltyRecipient: null,
                split: { protocolFee: "1000000", royalty: "0", seller: "9000000" },
              },
            ],
            new Set(["0x" + "a".repeat(40)]),
          ),
        };
      },
    };

    const result = await serviceWith(ingest, source).getArtistDashboard("artist-net-1", 30);

    expect(result.summary.totalPayoutUsd).toBe(10);
    expect(result.summary.payoutBasis).toBe("gross_settled");
    expect(result.netReceived).toMatchObject({
      status: "ready",
      basis: "net_after_fee_and_split",
      finalizedSales: 1,
      pendingSales: 0,
      totals: { grossFinalizedUsd: 10, netUsd: 9 },
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].artistId).toBe("artist-net-1");
    expect(calls[0].to.getTime()).toBeGreaterThan(calls[0].from.getTime());
  });

  it("a net source failure leaves the gross figures and says net is unavailable (never zero)", async () => {
    const ingest = new AnalyticsIngestService();
    await ingestGrossSale(ingest, "artist-net-2");
    const failing: ArtistNetReceivedSource = {
      async getArtistNetReceived() {
        throw new Error("database unavailable");
      },
    };

    const result = await serviceWith(ingest, failing).getArtistDashboard("artist-net-2", 30);

    expect(result.summary.totalPayoutUsd).toBe(10);
    expect(result.netReceived).toEqual({
      status: "unavailable",
      reason: expect.stringContaining("temporarily unavailable"),
    });
  });

  it("without a net source the dashboard has no netReceived block", async () => {
    const ingest = new AnalyticsIngestService();
    await ingestGrossSale(ingest, "artist-net-3");
    const result = await serviceWith(ingest).getArtistDashboard("artist-net-3", 30);
    expect("netReceived" in result).toBe(false);
  });
});
