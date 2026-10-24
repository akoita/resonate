/**
 * #2344: the artist's entitled net from x402 sales, read from real settlement
 * records. Real Postgres (Testcontainers), no mocks: X402Settlement rows (the
 * facilitator route and a Punchline moment edition) and `x402.purchase`
 * ContractEvents (the agent router and MCP) are written the way the rails write
 * them, with the quote recorded by the real receipt builder.
 */
import { prisma } from "../db/prisma";
import { PrismaArtistNetReceivedSource } from "../modules/analytics/analytics_net_received";
import { quoteEntitledNet } from "../modules/x402/x402.quote";
import { buildStemX402Receipt } from "../modules/x402/x402.receipt";

const P = `entitled_${Date.now()}_`;
const usdc = "0x" + "1".repeat(40);

describe("#2344 entitled net from x402 sales (integration)", () => {
  const userId = `${P}user`;
  const otherUserId = `${P}other_user`;
  const artistId = `${P}artist`;
  const otherArtistId = `${P}other_artist`;
  const releaseId = `${P}release`;
  const otherReleaseId = `${P}other_release`;
  const trackId = `${P}track`;
  const otherTrackId = `${P}other_track`;
  const dropId = `${P}drop`;
  const momentId = `${P}moment`;
  let stemId: string;
  let otherStemId: string;
  const source = new PrismaArtistNetReceivedSource();

  const window = () => ({
    artistId,
    from: new Date(Date.now() - 3_600_000),
    to: new Date(Date.now() + 3_600_000),
  });

  function receiptFor(stem: string, feeBps: number | undefined, amountUsd: number, units: string) {
    return buildStemX402Receipt({
      stemId: stem,
      stemType: "vocals",
      stemTitle: null,
      trackTitle: null,
      artist: null,
      releaseTitle: null,
      hasNft: false,
      tokenId: null,
      amountUsd,
      paymentAsset: { assetId: "x402:usdc", tokenAddress: usdc, symbol: "USDC", decimals: 6, amountUnits: units },
      network: "eip155:84532",
      payTo: "0x" + "9".repeat(40),
      resource: `/api/stems/${stem}/x402`,
      quoteUrl: `/api/stems/${stem}/x402/info`,
      mimeType: "audio/mpeg",
      contentLength: 0,
      eventTransactionHash: "x402:test",
      feeBps,
    });
  }

  function settlement(suffix: string, stem: string | null, receipt: Record<string, unknown>, overrides: Record<string, unknown> = {}) {
    return prisma.x402Settlement.create({
      data: {
        stemId: stem,
        payerAddress: "0x" + "b".repeat(40),
        paymentRail: "facilitator",
        receiptId: `${P}${suffix}`,
        receipt: receipt as never,
        status: "download_granted",
        contractSettlementStatus: "download_only",
        paymentToken: usdc,
        paymentAssetId: "x402:usdc",
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        settlementAmount: "0.05",
        settlementAmountUnits: "50000",
        canonicalAmountUsd: "0.05",
        purchasedAt: new Date(),
        ...overrides,
      },
    });
  }

  function directPurchase(suffix: string, stem: string, args: Record<string, unknown>) {
    return prisma.contractEvent.create({
      data: {
        eventName: "x402.purchase",
        chainId: 84532,
        contractAddress: "0x" + "f".repeat(40),
        transactionHash: `x402:${P}${suffix}`,
        logIndex: 0,
        blockNumber: 0n,
        blockHash: "",
        args: {
          source: "mcp",
          stemId: stem,
          settlementAmountUnits: "5000000",
          paymentToken: usdc,
          paymentAssetId: "x402:usdc",
          paymentAssetSymbol: "USDC",
          paymentAssetDecimals: 6,
          paymentProofSha256: `${P}proof_${suffix}`,
          ...args,
        } as never,
        processedAt: new Date(),
      },
    });
  }

  beforeAll(async () => {
    for (const [uid, aid, rid, tid] of [
      [userId, artistId, releaseId, trackId],
      [otherUserId, otherArtistId, otherReleaseId, otherTrackId],
    ] as const) {
      await prisma.user.create({ data: { id: uid, email: `${uid}@test.resonate` } });
      await prisma.artist.create({ data: { id: aid, userId: uid, displayName: aid, payoutAddress: "0x" + "d".repeat(40) } });
      await prisma.release.create({ data: { id: rid, title: rid, artistId: aid, status: "ready" } });
      await prisma.track.create({ data: { id: tid, title: `Title ${tid}`, releaseId: rid, position: 1 } });
    }
    stemId = (await prisma.stem.create({ data: { trackId, type: "vocals", uri: "/catalog/stems/e1.mp3" } })).id;
    otherStemId = (await prisma.stem.create({ data: { trackId: otherTrackId, type: "vocals", uri: "/catalog/stems/e2.mp3" } })).id;
    await prisma.punchlineDrop.create({ data: { id: dropId, trackId, artistId, status: "published" } });
    await prisma.punchlineMoment.create({
      data: { id: momentId, dropId, title: "Moment", lyricText: "la", editionSize: 10, priceCents: 150, startMs: 0, endMs: 1000 },
    });
  });

  afterAll(async () => {
    await prisma.x402Settlement.deleteMany({ where: { receiptId: { startsWith: P } } }).catch(() => {});
    await prisma.contractEvent.deleteMany({ where: { transactionHash: { startsWith: `x402:${P}` } } }).catch(() => {});
    await prisma.punchlineMoment.deleteMany({ where: { id: momentId } }).catch(() => {});
    await prisma.punchlineDrop.deleteMany({ where: { id: dropId } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: { in: [trackId, otherTrackId] } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { in: [trackId, otherTrackId] } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { in: [releaseId, otherReleaseId] } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: { in: [artistId, otherArtistId] } } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } }).catch(() => {});
  });

  it("reports an empty entitled block, and says x402 is entitled-only, when there are no x402 sales", async () => {
    const report = await source.getArtistNetReceived(window());
    if (report.status !== "ready") throw new Error("unavailable");
    expect(report.coverage.x402).toBe("entitled_only");
    expect(report.entitled.saleCount).toBe(0);
    expect(report.entitled.totals).toEqual({ grossQuotedUsd: 0, entitledNetUsd: 0 });
  });

  it("reports the quoted net of every x402 rail, apart from the on-chain net", async () => {
    // Facilitator route: a personal license, 0.05 USDC at 15%.
    await settlement("http", stemId, receiptFor(stemId, 1500, 0.05, "50000") as never);
    // A Punchline moment edition: 1.50 USDC at 15%.
    const momentReceipt = {
      payment: { quote: quoteEntitledNet("1500000", 1500) },
    };
    await settlement("moment", null, momentReceipt, {
      resourceKind: "punchline_moment",
      momentId,
      status: "collected",
      contractSettlementStatus: "not_applicable",
      settlementAmount: "1.5",
      settlementAmountUnits: "1500000",
      paymentProofSha256: `${P}moment_proof`,
    });
    // Direct rails: MCP (commercial 5 USDC at 10%) and the agent router, with the quote the rail records.
    await directPurchase("mcp", stemId, { quote: quoteEntitledNet("5000000", 1000) });

    const report = await source.getArtistNetReceived(window());
    if (report.status !== "ready") throw new Error("unavailable");
    expect(report.entitled.quotedSales).toBe(3);
    expect(report.entitled.unquotedSales).toBe(0);
    // 0.0425 + 1.275 + 4.5
    expect(report.entitled.totals.entitledNetUsd).toBe(5.8175);
    expect(report.entitled.totals.grossQuotedUsd).toBe(6.55);
    const rails = report.entitled.recentSales.map((sale) => `${sale.resourceKind}:${sale.paymentRail}`).sort();
    expect(rails).toEqual(["punchline_moment:facilitator", "stem:facilitator", "stem:mcp"]);
    const mcp = report.entitled.recentSales.find((sale) => sale.paymentRail === "mcp")!;
    expect(mcp.entitledNetUnits).toBe("4500000");
    expect(mcp.trackId).toBe(trackId);
    expect(mcp.trackTitle).toBe(`Title ${trackId}`);
    const moment = report.entitled.recentSales.find((sale) => sale.resourceKind === "punchline_moment")!;
    expect(moment.trackId).toBe(trackId);

    // The on-chain net is untouched: x402 never leaks into it.
    expect(report.saleCount).toBe(0);
    expect(report.totals).toEqual({ grossFinalizedUsd: 0, netUsd: 0, pendingGrossUsd: 0 });
  });

  it("counts a sale with no recorded quote apart and never reconstructs it", async () => {
    await settlement("legacy", stemId, { license: { key: "personal" } } as never);
    const report = await source.getArtistNetReceived(window());
    if (report.status !== "ready") throw new Error("unavailable");
    expect(report.entitled.unquotedSales).toBe(1);
    const legacy = report.entitled.recentSales.find((sale) => sale.status === "unquoted")!;
    expect(legacy.entitledNetUnits).toBeUndefined();
    expect(legacy.grossUsd).toBe(0.05);
    expect(report.entitled.totals.entitledNetUsd).toBe(5.8175);
  });

  it("leaves out what the marketplace rail counts, unfinished settlements, other artists and replayed proofs", async () => {
    const before = await source.getArtistNetReceived(window());
    if (before.status !== "ready") throw new Error("unavailable");
    const count = before.entitled.saleCount;

    await settlement("backed", stemId, receiptFor(stemId, 1500, 0.05, "50000") as never, { contractSettlementStatus: "contract_backed" });
    await settlement("refund", stemId, receiptFor(stemId, 1500, 0.05, "50000") as never, { status: "refund_due" });
    await settlement("failed", stemId, receiptFor(stemId, 1500, 0.05, "50000") as never, { status: "contract_settlement_failed" });
    await settlement("elsewhere", otherStemId, receiptFor(otherStemId, 1500, 0.05, "50000") as never);
    await directPurchase("other_artist", otherStemId, { quote: quoteEntitledNet("5000000", 1000) });
    // The same payment already recorded by the HTTP rail is counted there, once.
    await settlement("replayed", stemId, receiptFor(stemId, 1500, 0.05, "50000") as never, { paymentProofSha256: `${P}proof_replayed` });
    await directPurchase("replayed", stemId, { quote: quoteEntitledNet("5000000", 1000) });
    // Outside the window.
    await settlement("old", stemId, receiptFor(stemId, 1500, 0.05, "50000") as never, { purchasedAt: new Date(Date.now() - 86_400_000) });

    const after = await source.getArtistNetReceived(window());
    if (after.status !== "ready") throw new Error("unavailable");
    // Only the replayed-proof settlement itself is new (its direct duplicate is skipped).
    expect(after.entitled.saleCount).toBe(count + 1);
  });

  it("scopes each artist to their own x402 sales", async () => {
    const report = await source.getArtistNetReceived({ ...window(), artistId: otherArtistId });
    if (report.status !== "ready") throw new Error("unavailable");
    expect(report.entitled.quotedSales).toBe(2);
    expect(report.entitled.totals.entitledNetUsd).toBe(0.0425 + 4.5);
  });
});
