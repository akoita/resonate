import { prisma } from "../db/prisma";
import { AnalyticsConsentService, ANALYTICS_CONSENT_POLICY_VERSION } from "../modules/analytics/analytics_consent.service";
import { AnalyticsEventStore, PrismaAnalyticsEventStore } from "../modules/analytics/analytics_event_store";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { AnalyticsInstrumentationService } from "../modules/analytics/analytics_instrumentation.service";
import { SceneScoutService } from "../modules/scene_scout/scene_scout.service";
import { ShowsService } from "../modules/shows/shows.service";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";

const TEST_PREFIX = `show_pledge_demand_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const RELEASE_ID = `${TEST_PREFIX}release`;
const TRACK_ID = `${TEST_PREFIX}track`;
const CAMPAIGN_ID = `${TEST_PREFIX}campaign`;
const CITY = {
  countryCode: "CA",
  citySlug: "montreal",
  source: "user_declared",
  precision: "city",
} as const;
const CAMPAIGN_GEO = {
  countryCode: "FR",
  citySlug: "paris",
  source: "campaign_target",
  precision: "city",
} as const;

const consentService = new AnalyticsConsentService();
const showsService = new ShowsService(
  new AnalyticsInstrumentationService(
    new AnalyticsIngestService(new PrismaAnalyticsEventStore() as AnalyticsEventStore),
  ),
);
const sceneScout = new SceneScoutService();
let candidateSeq = 0;

function walletAddress(index: number) {
  return `0x${index.toString(16).padStart(40, "0")}`;
}

async function createUser(userId: string) {
  await prisma.user.create({
    data: { id: userId, email: `${userId}@test.resonate` },
  });
}

async function createCampaign(input: {
  id: string;
  artistId?: string;
  sourceReleaseId?: string | null;
  status?: string;
}) {
  return prisma.showCampaign.create({
    data: {
      id: input.id,
      slug: input.id,
      artistId: input.artistId ?? ARTIST_ID,
      sourceReleaseId: input.sourceReleaseId === undefined ? RELEASE_ID : input.sourceReleaseId,
      artistDisplayName: "Pledge Demand Artist",
      title: "Paris Show",
      city: "Paris",
      country: "FR",
      deadline: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      goalAmountUnits: "10000000",
      chainId: 8453,
      contractAddress: "0x1111111111111111111111111111111111111111",
      contractCampaignId: input.id,
      status: (input.status ?? "active") as any,
      campaignLevel: "active_escrow_campaign",
      artistAuthorityStatus: "artist_authorized",
      beneficiaryAddress: "0x2222222222222222222222222222222222222222",
      beneficiaryType: "wallet",
    },
  });
}

async function createIntent(input: {
  userId: string;
  campaignId?: string;
  wallet: string;
  geo?: unknown;
}) {
  return showsService.createPledgeIntent(
    { userId: input.userId },
    input.campaignId ?? CAMPAIGN_ID,
    {
      walletAddress: input.wallet,
      amountUnits: "1000000",
      geo: input.geo as any,
    },
  );
}

type DirectCandidateInput = {
  id: string;
  userId: string;
  campaignId?: string;
  contextUserId?: string;
  contextPolicyVersion?: string;
  confirmedAt?: Date;
  expiresAt?: Date;
  status?: string;
  confirmationStatus?: string;
  refundedAt?: Date | null;
  refundAvailableAt?: Date | null;
  failedAt?: Date | null;
  amountUnits?: string;
  transactionHash?: string;
  blockNumber?: bigint;
  wallet?: string;
  proof?: {
    source?: string;
    amountUnits?: string;
    transactionHash?: string;
    blockNumber?: bigint;
    wallet?: string;
  } | null;
};

async function createConfirmedCandidate(input: DirectCandidateInput) {
  candidateSeq += 1;
  const confirmedAt = input.confirmedAt ?? new Date();
  const amountUnits = input.amountUnits ?? "1000000";
  const transactionHash = input.transactionHash ?? `0x${"c".repeat(48)}${candidateSeq.toString(16).padStart(16, "0")}`;
  const blockNumber = input.blockNumber ?? BigInt(1000 + candidateSeq);
  const wallet = input.wallet ?? walletAddress(100 + candidateSeq);
  const campaignId = input.campaignId ?? CAMPAIGN_ID;
  const pledge = await prisma.showPledge.create({
    data: {
      id: input.id,
      campaignId,
      userId: input.userId,
      walletAddress: wallet,
      amountUnits,
      chainId: 8453,
      transactionHash,
      blockNumber,
      confirmationStatus: (input.confirmationStatus ?? "confirmed") as any,
      status: (input.status ?? "confirmed") as any,
      receiptId: `${TEST_PREFIX}receipt_${input.id}`,
      receipt: {},
      confirmedAt,
      refundedAt: input.refundedAt ?? null,
      refundAvailableAt: input.refundAvailableAt ?? null,
      failedAt: input.failedAt ?? null,
    },
  });
  await prisma.showPledgeDemandContext.create({
    data: {
      pledgeId: pledge.id,
      userId: input.contextUserId ?? input.userId,
      countryCode: "CA",
      citySlug: "montreal",
      consentPolicyVersion: input.contextPolicyVersion ?? ANALYTICS_CONSENT_POLICY_VERSION,
      declaredAt: new Date(confirmedAt.getTime() - 60_000),
      expiresAt: input.expiresAt ?? new Date(confirmedAt.getTime() + 7 * 24 * 60 * 60 * 1000),
    },
  });
  if (input.proof !== null) {
    const proof = input.proof ?? {};
    await prisma.showCampaignEvent.create({
      data: {
        campaignId,
        pledgeId: pledge.id,
        eventType: "pledge_confirmed",
        actorWalletAddress: proof.wallet ?? wallet,
        transactionHash: proof.transactionHash ?? transactionHash,
        blockNumber: proof.blockNumber ?? blockNumber,
        metadata: {
          source: proof.source ?? "escrow-indexer",
          onChainAmountUnits: proof.amountUnits ?? amountUnits,
        },
      },
    });
  }
  return pledge;
}

describe("consented show pledge demand (integration)", () => {
  jest.setTimeout(120_000);
  let previousAudienceFloor: string | undefined;
  let nextWallet = 1;
  const listeners = [
    `${TEST_PREFIX}listener_a`,
    `${TEST_PREFIX}listener_b`,
    `${TEST_PREFIX}listener_c`,
  ];

  beforeAll(async () => {
    previousAudienceFloor = process.env.DISCOVERY_MIN_AUDIENCE;
    process.env.DISCOVERY_MIN_AUDIENCE = "3";
    await createUser(OWNER_ID);
    await createUser(`${TEST_PREFIX}no_consent`);
    await createUser(`${TEST_PREFIX}stale_consent`);
    await createUser(`${TEST_PREFIX}refused_consent`);
    for (const userId of listeners) await createUser(userId);

    await prisma.artist.create({ data: { id: ARTIST_ID, userId: OWNER_ID, displayName: "Pledge Demand Artist" } });
    await prisma.release.create({
      data: { id: RELEASE_ID, artistId: ARTIST_ID, title: "Pledge Source Release", status: "ready" },
    });
    await prisma.track.create({
      data: { id: TRACK_ID, releaseId: RELEASE_ID, title: "Pledge Source Track", position: 1 },
    });
    await createCampaign({ id: CAMPAIGN_ID });

    for (const userId of listeners) await consentService.record(userId, true);
    await consentService.record(`${TEST_PREFIX}refused_consent`, false);
    await prisma.analyticsConsent.create({
      data: {
        userId: `${TEST_PREFIX}stale_consent`,
        productAnalytics: true,
        policyVersion: "analytics-consent:old-policy",
        decidedAt: new Date(),
      },
    });
    for (const userId of [
      `${TEST_PREFIX}no_consent`,
      `${TEST_PREFIX}stale_consent`,
      `${TEST_PREFIX}refused_consent`,
      ...listeners,
    ]) {
      const address = walletAddress(nextWallet++);
      await prisma.wallet.create({ data: { userId, address, chainId: 8453 } });
    }
    await prisma.artist.create({
      data: { id: `${TEST_PREFIX}foreign_artist`, displayName: "Foreign Pledge Artist" },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}foreign_release`,
        artistId: `${TEST_PREFIX}foreign_artist`,
        title: "Foreign Source Release",
        status: "ready",
      },
    });
    await prisma.track.create({
      data: { id: `${TEST_PREFIX}foreign_track`, releaseId: `${TEST_PREFIX}foreign_release`, title: "Foreign Track", position: 1 },
    });
    await createCampaign({
      id: `${TEST_PREFIX}foreign_campaign`,
      artistId: `${TEST_PREFIX}foreign_artist`,
      sourceReleaseId: `${TEST_PREFIX}foreign_release`,
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}withdrawn_release`,
        artistId: ARTIST_ID,
        title: "Withdrawn Source Release",
        status: "ready",
        withdrawnAt: new Date(),
      },
    });
    await prisma.track.create({
      data: { id: `${TEST_PREFIX}withdrawn_track`, releaseId: `${TEST_PREFIX}withdrawn_release`, title: "Withdrawn Track", position: 1 },
    });
    await createCampaign({
      id: `${TEST_PREFIX}withdrawn_campaign`,
      sourceReleaseId: `${TEST_PREFIX}withdrawn_release`,
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}processing_release`,
        artistId: ARTIST_ID,
        title: "Processing Source Release",
        status: "processing",
      },
    });
    await prisma.track.create({
      data: { id: `${TEST_PREFIX}processing_track`, releaseId: `${TEST_PREFIX}processing_release`, title: "Processing Track", position: 1 },
    });
    await createCampaign({
      id: `${TEST_PREFIX}processing_campaign`,
      sourceReleaseId: `${TEST_PREFIX}processing_release`,
    });
    await createCampaign({ id: `${TEST_PREFIX}cancelled_campaign`, status: "cancelled" });
  });

  afterAll(async () => {
    await prisma.sceneScoutCityDemand.deleteMany({ where: { artistId: ARTIST_ID } });
    await prisma.analyticsEvent.deleteMany({ where: { OR: [
      { subjectId: { startsWith: TEST_PREFIX } },
      // Save fixtures identify their track in payload, without a subjectId.
      { eventId: { startsWith: TEST_PREFIX } },
    ] } });
    expect(await prisma.analyticsEvent.count({ where: { eventId: { startsWith: TEST_PREFIX } } })).toBe(0);
    await prisma.showCampaign.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.showCampaignTier.deleteMany({ where: { campaignId: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { releaseId: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.wallet.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.analyticsConsent.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.listenerTasteMemorySettings.deleteMany({ where: { userId: { startsWith: TEST_PREFIX } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    if (previousAudienceFloor === undefined) delete process.env.DISCOVERY_MIN_AUDIENCE;
    else process.env.DISCOVERY_MIN_AUDIENCE = previousAudienceFloor;
    await prisma.$disconnect();
  });

  it("captures only current-consent explicit cities and never copies listener city into the pledge DTO or Shows ledger", async () => {
    const granted = listeners[0];
    const valid = await createIntent({
      userId: granted,
      wallet: await walletFor(granted),
      geo: CITY,
    });
    const context = await prisma.showPledgeDemandContext.findUnique({ where: { pledgeId: valid.pledge.id } });
    expect(context).toEqual(expect.objectContaining({
      userId: granted,
      countryCode: "CA",
      citySlug: "montreal",
      consentPolicyVersion: ANALYTICS_CONSENT_POLICY_VERSION,
      expiresAt: expect.any(Date),
    }));
    const pledgeJson = JSON.stringify(valid.pledge).toLowerCase();
    expect(pledgeJson).not.toContain("montreal");
    expect(pledgeJson).not.toContain("demandcontext");

    const analytics = await prisma.analyticsEvent.findFirst({
      where: { eventName: "shows.pledge_intent_created", subjectId: CAMPAIGN_ID },
      orderBy: { occurredAt: "desc" },
    });
    expect(analytics?.envelope).toEqual(expect.objectContaining({
      geo: expect.objectContaining({ countryCode: "FR", citySlug: "paris", source: "campaign_target" }),
    }));
    expect(JSON.stringify(analytics?.envelope).toLowerCase()).not.toContain("montreal");

    const deniedGeo: Array<[string, unknown]> = [
      ["campaign target", CAMPAIGN_GEO],
      ["IP-derived", { ...CITY, source: "ip_coarse" }],
      ["region-only", { countryCode: "CA", regionCode: "QC", source: "user_declared", precision: "region" }],
      ["missing source", { countryCode: "CA", citySlug: "montreal", precision: "city" }],
      ["missing city", { countryCode: "CA", source: "user_declared", precision: "city" }],
    ];
    for (const [label, geo] of deniedGeo) {
      const intent = await createIntent({ userId: granted, wallet: await walletFor(granted), geo });
      const context = await prisma.showPledgeDemandContext.findUnique({ where: { pledgeId: intent.pledge.id } });
      expect({ label, context }).toEqual({ label, context: null });
      expect(await prisma.showPledge.findUnique({ where: { id: intent.pledge.id } })).not.toBeNull();
    }

    const noConsent = `${TEST_PREFIX}no_consent`;
    const staleConsent = `${TEST_PREFIX}stale_consent`;
    const refused = `${TEST_PREFIX}refused_consent`;
    for (const userId of [noConsent, staleConsent, refused]) {
      const intent = await createIntent({ userId, wallet: await walletFor(userId), geo: CITY });
      expect(await prisma.showPledgeDemandContext.findUnique({ where: { pledgeId: intent.pledge.id } })).toBeNull();
    }

    const beforeWithdrawal = await createIntent({ userId: granted, wallet: await walletFor(granted), geo: CITY });
    await consentService.record(granted, false);
    expect(await prisma.showPledgeDemandContext.findUnique({ where: { pledgeId: beforeWithdrawal.pledge.id } })).toBeNull();
    expect(await prisma.showPledge.findUnique({ where: { id: beforeWithdrawal.pledge.id } })).not.toBeNull();
    await consentService.record(granted, true);
    expect(await prisma.showPledgeDemandContext.findUnique({ where: { pledgeId: beforeWithdrawal.pledge.id } })).toBeNull();
  });

  it("serves pledge-only demand from exact indexer proof and deduplicates the same person across ledger and pledge signals", async () => {
    const acceptedPledges: string[] = [];
    const counts = [2, 2, 1];
    for (const [userIndex, count] of counts.entries()) {
      const userId = listeners[userIndex];
      for (let index = 0; index < count; index += 1) {
        const intent = await createIntent({
          userId,
          wallet: await walletFor(userId),
          geo: CITY,
        });
        const pledgeId = intent.pledge.id;
        const transactionHash = `0x${(acceptedPledges.length + 1).toString(16).padStart(64, "0")}`;
        const blockNumber = BigInt(200 + acceptedPledges.length);
        const confirmedAt = new Date();
        const confirmed = await prisma.showPledge.update({
          where: { id: pledgeId },
          data: {
            status: "confirmed",
            confirmationStatus: "confirmed",
            transactionHash,
            blockNumber,
            confirmedAt,
          },
        });
        await prisma.showCampaignEvent.create({
          data: {
            campaignId: CAMPAIGN_ID,
            pledgeId,
            eventType: "pledge_confirmed",
            actorWalletAddress: confirmed.walletAddress,
            transactionHash,
            blockNumber,
            metadata: { source: "escrow-indexer", onChainAmountUnits: confirmed.amountUnits },
          },
        });
        acceptedPledges.push(pledgeId);
      }
    }

    // Read after all confirmations exist; fixture writes may take over a second.
    const pledgeOnly = await sceneScout.getArtistSceneScout(ARTIST_ID, { now: new Date() });
    expect(pledgeOnly.status).toBe("ready");
    const week = pledgeOnly.cityDemand.find((row) => row.windowDays === 7 && row.citySlug === "montreal");
    expect(week).toEqual(expect.objectContaining({
      uniqueListeners: 3,
      pledges: 5,
      signalCount: 5,
      saves: 0,
      resonantListeners: 0,
    }));
    expect(JSON.stringify(pledgeOnly).toLowerCase()).not.toContain("listener_");
    expect(JSON.stringify(pledgeOnly)).not.toContain(acceptedPledges[0]);

    await prisma.analyticsEvent.create({
      data: {
        eventId: `${TEST_PREFIX}ledger_save`,
        eventName: "playlist.track_added",
        eventVersion: 1,
        occurredAt: new Date(),
        receivedAt: new Date(),
        producer: "playback-service",
        environment: "test",
        privacyTier: "pseudonymous",
        actorId: pseudonymousAnalyticsActorId(listeners[0]),
        consentBasis: "consent",
        payload: { trackId: TRACK_ID },
        envelope: { geo: CITY },
      },
    });
    const combined = await sceneScout.getArtistSceneScout(ARTIST_ID, { now: new Date(Date.now() + 1_000) });
    const combinedWeek = combined.cityDemand.find((row) => row.windowDays === 7 && row.citySlug === "montreal");
    expect(combinedWeek).toEqual(expect.objectContaining({ uniqueListeners: 3, pledges: 5, saves: 1, signalCount: 6 }));
  });

  it("rejects non-indexer or mismatched proof and excludes expired, stale-consent, reset, refunded, cancelled, withdrawn, and foreign rows", async () => {
    const current = listeners[0];
    const confirmedAt = new Date();
    const baseId = `${TEST_PREFIX}invalid_`;
    const candidate = async (suffix: string, values: Partial<DirectCandidateInput> = {}) => {
      return createConfirmedCandidate({
        id: `${baseId}${suffix}`,
        userId: current,
        confirmedAt,
        ...values,
      });
    };
    await candidate("operator", { proof: { source: "operator" } });
    await candidate("bad_amount", { proof: { source: "escrow-indexer", amountUnits: "999" } });
    await candidate("bad_hash", { proof: { source: "escrow-indexer", transactionHash: "0xwrong" } });
    await candidate("bad_block", { proof: { source: "escrow-indexer", blockNumber: 999_999n } });
    await candidate("bad_wallet", { proof: { source: "escrow-indexer", wallet: walletAddress(999_999) } });
    const noProof = await candidate("no_proof", { proof: null });
    await prisma.analyticsEvent.create({
      data: {
        eventId: `${TEST_PREFIX}forged_pledge_ledger`,
        eventName: "shows.pledge_confirmed",
        eventVersion: 1,
        occurredAt: confirmedAt,
        receivedAt: confirmedAt,
        producer: "shows-service",
        environment: "test",
        privacyTier: "pseudonymous",
        actorId: pseudonymousAnalyticsActorId(current),
        subjectType: "show_pledge",
        subjectId: noProof.id,
        payload: { pledgeId: noProof.id, source: "escrow-indexer" },
        envelope: { geo: CITY },
      },
    });
    await candidate("wrong_context_user", { contextUserId: listeners[1] });
    await candidate("stale_policy", { contextPolicyVersion: "analytics-consent:old-policy" });
    await candidate("expired", { expiresAt: new Date(Date.now() - 1000) });
    await candidate("refunded", { status: "refunded", refundedAt: confirmedAt });
    await candidate("refund_available", { status: "refund_available", refundAvailableAt: confirmedAt });
    await candidate("failed", { status: "failed", failedAt: confirmedAt });
    await candidate("cancelled_campaign", { campaignId: `${TEST_PREFIX}cancelled_campaign` });
    await candidate("foreign_release", { campaignId: `${TEST_PREFIX}foreign_campaign` });
    await candidate("withdrawn_release", { campaignId: `${TEST_PREFIX}withdrawn_campaign` });
    await candidate("non_public_release", { campaignId: `${TEST_PREFIX}processing_campaign` });

    const noConsentUser = `${TEST_PREFIX}no_consent`;
    await createConfirmedCandidate({
      id: `${baseId}no_current_grant`,
      userId: noConsentUser,
      confirmedAt,
    });
    const resetUser = `${TEST_PREFIX}reset_user`;
    await createUser(resetUser);
    await consentService.record(resetUser, true);
    const resetWallet = walletAddress(nextWallet++);
    await prisma.wallet.create({ data: { userId: resetUser, address: resetWallet, chainId: 8453 } });
    await prisma.listenerTasteMemorySettings.create({ data: { userId: resetUser, resetAt: new Date(confirmedAt.getTime() - 30_000) } });
    await createConfirmedCandidate({ id: `${baseId}reset`, userId: resetUser, confirmedAt });

    const result = await sceneScout.getArtistSceneScout(ARTIST_ID, { now: new Date(Date.now() + 1000) });
    const week = result.cityDemand.find((row) => row.windowDays === 7 && row.citySlug === "montreal");
    expect(week).toEqual(expect.objectContaining({ uniqueListeners: 3, pledges: 5, saves: 1, signalCount: 6 }));
    expect(await prisma.showPledgeDemandContext.findUnique({ where: { pledgeId: `${baseId}expired` } })).toBeNull();
  });

  it("serializes a concurrent consent refusal with city capture without reviving deleted context", async () => {
    const userId = `${TEST_PREFIX}refused_consent`;
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await consentService.record(userId, true);
      const [intent] = await Promise.all([
        createIntent({ userId, wallet: await walletFor(userId), geo: CITY }),
        consentService.record(userId, false),
      ]);
      expect(await prisma.showPledgeDemandContext.count({ where: { userId } })).toBe(0);
      expect(await prisma.showPledge.findUnique({ where: { id: intent.pledge.id } })).not.toBeNull();
      await consentService.record(userId, true);
      expect(await prisma.showPledgeDemandContext.count({ where: { userId } })).toBe(0);
    }
    const fresh = await createIntent({ userId, wallet: await walletFor(userId), geo: CITY });
    expect(await prisma.showPledgeDemandContext.findUnique({ where: { pledgeId: fresh.pledge.id } })).not.toBeNull();
  });

  it("suppresses estimates and clears snapshots when ledger plus pledge candidates exceed the shared cap", async () => {
    expect(await prisma.sceneScoutCityDemand.count({ where: { artistId: ARTIST_ID } })).toBeGreaterThan(0);
    const occurredAt = new Date();
    // The earlier save contributes one ledger row. These leave capacity for
    // four pledge candidates, fewer than the five accepted confirmations.
    for (let offset = 0; offset < 19_995; offset += 1_000) {
      await prisma.analyticsEvent.createMany({ data: Array.from(
        { length: Math.min(1_000, 19_995 - offset) }, (_, index) => ({
          eventId: `${TEST_PREFIX}cap_${offset + index}`, eventName: "playlist.track_added",
          eventVersion: 1, occurredAt, receivedAt: occurredAt,
          producer: "playback-service", environment: "test", privacyTier: "pseudonymous",
          actorId: pseudonymousAnalyticsActorId(listeners[0]), consentBasis: "consent",
          subjectId: TRACK_ID, payload: { trackId: TRACK_ID }, envelope: { geo: CITY },
        }),
      ) });
    }
    const result = await sceneScout.getArtistSceneScout(ARTIST_ID, { now: new Date(Date.now() + 1_000) });
    expect(result).toMatchObject({ status: "thin_data", cityDemand: [] });
    expect(result.reason).toContain("full recent signal window");
    expect(await prisma.sceneScoutCityDemand.count({ where: { artistId: ARTIST_ID } })).toBe(0);
  });

  async function walletFor(userId: string) {
    const wallet = await prisma.wallet.findUnique({ where: { userId }, select: { address: true } });
    if (!wallet) throw new Error(`Missing test wallet for ${userId}`);
    return wallet.address;
  }
});
