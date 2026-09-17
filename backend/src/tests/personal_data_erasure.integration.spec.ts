/**
 * An erasure end to end (#1771 slice 3), against a real Postgres.
 *
 * Two people are seeded with the same spread of rows. One asks to be erased;
 * the other is the control, and is erased afterwards so both directions are
 * checked. Every assertion below is made against the database rather than
 * against the summary the engine reports about itself — an engine that
 * miscounts what it deleted would otherwise pass its own exam.
 *
 * The person's `User.id` is their lowercased wallet address, as
 * `auth.service.ts` writes it for a wallet account. That is the whole reason
 * the id is rotated, and it makes "the address appears nowhere it should not"
 * a searchable assertion rather than a hopeful one.
 */
import { AccountClosureStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import { pseudonymousAnalyticsActorId } from "../modules/analytics/analytics_identity";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";
import { ERASED_EMAIL_DOMAIN } from "../modules/privacy/personal_data_erasure_manifest";

const RUN = Date.now().toString(16);
const TEST_PREFIX = `erasure_${RUN}_`;

/** 0x + 40 hex, unique per run, and the same address in two casings. */
function address(tag: string, upper: boolean) {
  const body = (tag + RUN).padEnd(40, "0").slice(0, 40);
  return `0x${upper ? body.toUpperCase() : body}`;
}

const A_WALLET_LOWER = address("aaaa", false);
const A_WALLET_CHECKSUMMED = address("aaaa", true);
const A_OWNER_LOWER = address("cccc", false);
const B_WALLET_LOWER = address("bbbb", false);
const B_WALLET_CHECKSUMMED = address("bbbb", true);

// `User.id` is the lowercased wallet address for a wallet account.
const USER_A = A_WALLET_LOWER;
const USER_B = B_WALLET_LOWER;

const A_PRIVATE_KEY = `0x${"a7".repeat(32)}`;
const B_PRIVATE_KEY = `0x${"b7".repeat(32)}`;

const closures = new AccountClosureService();
const service = new PersonalDataErasureService(
  new PersonalDataResolverService(),
  // The default warehouse target is disabled without a BigQuery warehouse
  // configured, which is what a test environment is.
  new AnalyticsGovernanceService(),
  closures,
);

interface Seed {
  userId: string;
  walletLower: string;
  walletChecksummed: string;
  ownerAddress?: string;
  privateKey: string;
  suffix: "a" | "b";
}

const SEED_A: Seed = {
  userId: USER_A,
  walletLower: A_WALLET_LOWER,
  walletChecksummed: A_WALLET_CHECKSUMMED,
  ownerAddress: A_OWNER_LOWER,
  privateKey: A_PRIVATE_KEY,
  suffix: "a",
};
const SEED_B: Seed = {
  userId: USER_B,
  walletLower: B_WALLET_LOWER,
  walletChecksummed: B_WALLET_CHECKSUMMED,
  privateKey: B_PRIVATE_KEY,
  suffix: "b",
};

const id = (name: string, suffix: string) => `${TEST_PREFIX}${name}_${suffix}`;

async function seed(person: Seed) {
  const own = (name: string) => id(name, person.suffix);

  await prisma.user.create({
    data: { id: person.userId, email: `${person.userId}@wallet.resonate` },
  });

  // --- the address-to-person mappings, which erasure severs ----------------
  await prisma.wallet.create({
    data: {
      id: own("wallet"),
      userId: person.userId,
      // Stored checksummed while the resolver returns lowercase.
      address: person.walletChecksummed,
      ownerAddress: person.ownerAddress ?? null,
      chainId: 11155111,
      salt: `${TEST_PREFIX}salt_${person.suffix}`,
    },
  });
  await prisma.passkeyIdentity.create({
    data: {
      id: own("passkey"),
      userId: person.userId,
      publicKeyHash: `${TEST_PREFIX}pk_hash_${person.suffix}`,
      firstWalletAddress: person.walletChecksummed,
    },
  });
  await prisma.signupFaucetAttempt.create({
    data: {
      id: own("faucet"),
      userId: person.userId,
      walletAddress: person.walletChecksummed,
      chainId: 11155111,
      amountWei: "1000",
      status: "sent",
    },
  });
  await prisma.webAuthnCredential.create({
    data: {
      id: own("webauthn"),
      userId: person.userId,
      credentialId: `${TEST_PREFIX}cred_${person.suffix}`,
      publicKey: Buffer.from(`${TEST_PREFIX}${person.suffix}`),
      transports: ["internal"],
      passkeyName: `${TEST_PREFIX}passkey_${person.suffix}`,
      rpId: "localhost",
    },
  });
  await prisma.sessionKey.create({
    data: {
      id: own("session_key"),
      userId: person.userId,
      agentPrivateKey: person.privateKey,
      agentAddress: address(`dd${person.suffix}`, false),
      permissions: { target: "0x0", totalCap: 1 },
      validUntil: new Date("2027-01-01T00:00:00.000Z"),
    },
  });

  // --- anonymize ------------------------------------------------------------
  await prisma.communityProfile.create({
    data: {
      id: own("profile"),
      userId: person.userId,
      displayName: `${TEST_PREFIX}display_${person.suffix}`,
      bio: `${TEST_PREFIX}bio_${person.suffix}`,
      avatarUrl: `https://example.invalid/${TEST_PREFIX}${person.suffix}.png`,
    },
  });
  await prisma.folder.create({
    data: { id: own("folder"), userId: person.userId, name: `${TEST_PREFIX}folder_${person.suffix}` },
  });
  await prisma.playlist.create({
    data: {
      id: own("playlist"),
      userId: person.userId,
      folderId: own("folder"),
      name: `${TEST_PREFIX}playlist_${person.suffix}`,
      // Public on purpose: a kept playlist must not stay browsable under an
      // erased account.
      visibility: "public",
    },
  });
  // A key column that is not called `userId`.
  await prisma.communityRoom.create({
    data: {
      id: own("room"),
      roomType: "artist",
      // Dangling and polymorphic: `ownerId` has no relation behind it, so the
      // cascade cannot reach it.
      ownerType: "user",
      ownerId: person.userId,
      title: `${TEST_PREFIX}room_${person.suffix}`,
    },
  });
  await prisma.communityMessage.create({
    data: {
      id: own("message"),
      roomId: own("room"),
      authorId: person.userId,
      body: `${TEST_PREFIX}message_body_${person.suffix}`,
    },
  });
  await prisma.agentConfig.create({
    data: {
      id: own("agent_config"),
      userId: person.userId,
      name: `${TEST_PREFIX}agent_${person.suffix}`,
      vibes: [`${TEST_PREFIX}vibe_${person.suffix}`],
      learnedTasteProfile: { marker: `${TEST_PREFIX}taste_${person.suffix}` },
    },
  });
  await prisma.libraryTrack.create({
    data: {
      id: own("library_track"),
      userId: person.userId,
      title: `${TEST_PREFIX}library_title_${person.suffix}`,
      sourcePath: `/home/${TEST_PREFIX}${person.suffix}/Music/track.flac`,
      isOwned: true,
    },
  });
  // Wallet-keyed and stored checksummed, in three different tables.
  await prisma.curatorReputation.create({
    data: {
      id: own("curator"),
      walletAddress: person.walletChecksummed,
      score: 42,
      reportsFiled: 3,
      verifiedHuman: true,
      humanVerificationProvider: `${TEST_PREFIX}provider_${person.suffix}`,
      humanVerificationStatus: "verified",
      humanVerificationScore: 0.99,
    },
  });
  await prisma.notification.create({
    data: {
      id: own("notification"),
      walletAddress: person.walletChecksummed,
      type: "dispute_filed",
      title: `${TEST_PREFIX}notification_${person.suffix}`,
      message: `${TEST_PREFIX}notification_text_${person.suffix}`,
    },
  });
  await prisma.notificationPreference.create({
    data: { walletAddress: person.walletChecksummed, disputeFiled: false },
  });

  // --- retained, with a dangling user id that must be rewritten -------------
  await prisma.keyAuditLog.create({
    data: { id: own("key_audit"), userId: person.userId, action: "session_key_issued" },
  });
  await prisma.session.create({
    data: { id: own("session"), userId: person.userId, budgetCapUsd: 5 },
  });
  await prisma.agentTransaction.create({
    data: {
      id: own("agent_tx"),
      sessionId: own("session"),
      userId: person.userId,
      listingId: 1n,
      tokenId: 1n,
      amount: 1n,
      totalPriceWei: "1000",
      priceUsd: 1.5,
    },
  });
  // A financial record keyed by the address, which is retained as it is.
  await prisma.royaltyPayment.create({
    data: {
      id: own("royalty"),
      tokenId: 7n,
      chainId: 11155111,
      recipientAddress: person.walletChecksummed,
      amount: "1000000000000000",
      transactionHash: `0x${(person.suffix + RUN).padEnd(64, "0").slice(0, 64)}`,
      blockNumber: 1n,
      paidAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  });

  // --- the catalogue other people bought from -------------------------------
  await prisma.artist.create({
    data: {
      id: own("artist"),
      userId: person.userId,
      displayName: `${TEST_PREFIX}artist_${person.suffix}`,
      payoutAddress: person.walletChecksummed,
    },
  });
  await prisma.release.create({
    data: {
      id: own("release"),
      artistId: own("artist"),
      title: `${TEST_PREFIX}release_${person.suffix}`,
      status: "published",
    },
  });
  await prisma.track.create({
    data: { id: own("track"), releaseId: own("release"), title: `${TEST_PREFIX}track_${person.suffix}` },
  });
  await prisma.stem.create({
    data: { id: own("stem"), trackId: own("track"), type: "vocals", uri: `ipfs://${TEST_PREFIX}${person.suffix}` },
  });
  await prisma.stemListing.create({
    data: {
      id: own("listing"),
      stemId: own("stem"),
      listingId: BigInt(person.suffix === "a" ? 101 : 102),
      tokenId: 1n,
      chainId: 11155111,
      contractAddress: address("ffff", false),
      sellerAddress: person.walletChecksummed,
      pricePerUnit: "1000",
      amount: 1n,
      paymentToken: address("0000", false),
      expiresAt: new Date("2027-01-01T00:00:00.000Z"),
      transactionHash: `0x${(`c${person.suffix}` + RUN).padEnd(64, "1").slice(0, 64)}`,
      blockNumber: 1n,
      listedAt: new Date("2026-09-01T00:00:00.000Z"),
    },
  });

  // --- analytics, keyed BOTH ways -------------------------------------------
  await prisma.analyticsEvent.create({
    data: {
      id: own("analytics_hashed"),
      eventId: own("analytics_hashed_event"),
      eventName: "playback.completed",
      eventVersion: 1,
      occurredAt: new Date("2026-09-01T00:00:00.000Z"),
      receivedAt: new Date("2026-09-01T00:00:01.000Z"),
      producer: "backend",
      environment: "test",
      privacyTier: "pseudonymous",
      actorId: pseudonymousAnalyticsActorId(person.userId),
      payload: { marker: `${TEST_PREFIX}payload_${person.suffix}` },
      envelope: { marker: `${TEST_PREFIX}envelope_${person.suffix}` },
    },
  });
  // The bridge writes the raw `User.id` — the wallet address — straight
  // through as `actorId` and `subjectId` for around twenty event types.
  await prisma.analyticsEvent.create({
    data: {
      id: own("analytics_raw"),
      eventId: own("analytics_raw_event"),
      eventName: "taste_memory.settings_updated",
      eventVersion: 1,
      occurredAt: new Date("2026-09-02T00:00:00.000Z"),
      receivedAt: new Date("2026-09-02T00:00:01.000Z"),
      producer: "backend",
      environment: "test",
      privacyTier: "personal",
      actorId: person.userId,
      subjectType: "taste_memory",
      subjectId: person.userId,
      payload: { marker: `${TEST_PREFIX}raw_payload_${person.suffix}` },
      envelope: { marker: `${TEST_PREFIX}raw_envelope_${person.suffix}` },
    },
  });
  // The same person's address recorded in the casing an on-chain writer used.
  await prisma.analyticsEvent.create({
    data: {
      id: own("analytics_checksummed"),
      eventId: own("analytics_checksummed_event"),
      eventName: "contract.stem_listed",
      eventVersion: 1,
      occurredAt: new Date("2026-09-03T00:00:00.000Z"),
      receivedAt: new Date("2026-09-03T00:00:01.000Z"),
      producer: "indexer",
      environment: "test",
      privacyTier: "pseudonymous",
      actorId: person.walletChecksummed,
      payload: { marker: `${TEST_PREFIX}chain_payload_${person.suffix}` },
      envelope: { marker: `${TEST_PREFIX}chain_envelope_${person.suffix}` },
    },
  });
}

/**
 * The cross-person rows: B buys A's stem, and the two campaign disputes that
 * decide whether `matchOn` is honoured.
 */
async function seedShared() {
  await prisma.stemPurchase.create({
    data: {
      id: id("purchase", "b_buys_a"),
      listingId: id("listing", "a"),
      buyerAddress: B_WALLET_CHECKSUMMED,
      amount: 1n,
      totalPaid: "1000",
      royaltyPaid: "100",
      protocolFeePaid: "50",
      sellerReceived: "850",
      transactionHash: `0x${("dd" + RUN).padEnd(64, "2").slice(0, 64)}`,
      blockNumber: 2n,
      purchasedAt: new Date("2026-09-05T00:00:00.000Z"),
    },
  });

  await prisma.showCampaign.create({
    data: {
      id: id("campaign", "b"),
      artistId: id("artist", "b"),
      slug: `${TEST_PREFIX}campaign`,
      artistDisplayName: `${TEST_PREFIX}artist_b`,
      title: `${TEST_PREFIX}campaign_title`,
      city: "Paris",
      country: "FR",
      deadline: new Date("2027-01-01T00:00:00.000Z"),
      goalAmountUnits: "100",
      chainId: 11155111,
    },
  });
  // A started this one: their `reason` is their own words and is scrubbed.
  await prisma.showCampaignDispute.create({
    data: {
      id: id("dispute", "a_initiated"),
      campaignId: id("campaign", "b"),
      initiatorUserId: USER_A,
      initiatorRole: "backer",
      reason: `${TEST_PREFIX}dispute_reason_a`,
      operatorNote: `${TEST_PREFIX}operator_note_on_a`,
    },
  });
  // B started this one and A merely resolved it. Scrubbing on
  // `resolvedByUserId` would erase B's account of the dispute; only the
  // dangling id is rewritten.
  await prisma.showCampaignDispute.create({
    data: {
      id: id("dispute", "b_initiated"),
      campaignId: id("campaign", "b"),
      initiatorUserId: USER_B,
      initiatorRole: "artist",
      reason: `${TEST_PREFIX}dispute_reason_b`,
      resolvedByUserId: USER_A,
      resolvedAt: new Date("2026-09-10T00:00:00.000Z"),
    },
  });
}

async function cleanup() {
  const where = { id: { startsWith: TEST_PREFIX } };
  // Whatever the user ids have rotated to, the retained rows still point at
  // them, so the users are found through a row that survives the erasure.
  const audits = await prisma.keyAuditLog.findMany({ where, select: { userId: true } });
  const artists = await prisma.artist.findMany({ where, select: { userId: true } });
  const userIds = [
    ...new Set([
      USER_A,
      USER_B,
      ...audits.map((row) => row.userId),
      ...artists.map((row) => row.userId).filter((value): value is string => Boolean(value)),
    ]),
  ];

  await prisma.showCampaignDispute.deleteMany({ where });
  await prisma.showCampaign.deleteMany({ where });
  await prisma.stemPurchase.deleteMany({ where });
  await prisma.stemListing.deleteMany({ where });
  await prisma.stem.deleteMany({ where });
  await prisma.track.deleteMany({ where });
  await prisma.release.deleteMany({ where });
  await prisma.artist.deleteMany({ where });
  await prisma.royaltyPayment.deleteMany({ where });
  await prisma.agentTransaction.deleteMany({ where });
  await prisma.session.deleteMany({ where });
  await prisma.keyAuditLog.deleteMany({ where });
  await prisma.notificationPreference.deleteMany({
    where: { walletAddress: { in: [A_WALLET_CHECKSUMMED, B_WALLET_CHECKSUMMED] } },
  });
  await prisma.notification.deleteMany({ where });
  await prisma.curatorReputation.deleteMany({ where });
  await prisma.libraryTrack.deleteMany({ where });
  await prisma.agentConfig.deleteMany({ where });
  await prisma.communityMessage.deleteMany({ where });
  await prisma.communityRoom.deleteMany({ where });
  await prisma.playlist.deleteMany({ where });
  await prisma.folder.deleteMany({ where });
  await prisma.communityProfile.deleteMany({ where });
  await prisma.sessionKey.deleteMany({ where });
  await prisma.webAuthnCredential.deleteMany({ where });
  await prisma.signupFaucetAttempt.deleteMany({ where });
  await prisma.passkeyIdentity.deleteMany({ where });
  await prisma.wallet.deleteMany({ where });
  await prisma.analyticsGovernanceLog.deleteMany({
    where: {
      OR: [
        { eventId: { startsWith: TEST_PREFIX } },
        { actorId: { in: userIds } },
        {
          actorId: {
            in: [USER_A, USER_B, A_WALLET_CHECKSUMMED, B_WALLET_CHECKSUMMED]
              .map((value) => pseudonymousAnalyticsActorId(value))
              .filter((value): value is string => Boolean(value)),
          },
        },
        { actorId: { in: [A_WALLET_CHECKSUMMED, B_WALLET_CHECKSUMMED] } },
      ],
    },
  });
  await prisma.analyticsEvent.deleteMany({ where });
  await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe("PersonalDataErasureService integration", () => {
  /** The rotated id the erasure left behind. Never the pre-erasure one. */
  let newUserId: string;
  let requestId: string;

  beforeAll(async () => {
    await seed(SEED_A);
    await seed(SEED_B);
    await seedShared();

    const request = await closures.request(USER_A, `${TEST_PREFIX}closure_reason_a`);
    requestId = request.id;
    // Backdate the request past its 30-day window so the due queue picks it up.
    await prisma.accountClosureRequest.update({
      where: { id: requestId },
      data: { dueAt: new Date("2026-01-01T00:00:00.000Z") },
    });

    const run = await service.runDueErasures({ now: new Date("2026-06-01T00:00:00.000Z") });
    const outcome = run.results.find((result) => result.requestId === requestId);
    if (!outcome || outcome.status !== "erased" || !outcome.newUserId) {
      throw new Error(`Erasure did not run: ${JSON.stringify(outcome)}`);
    }
    newUserId = outcome.newUserId;

    // The summary reports counts, never values: the pre-rotation id is the
    // person's wallet address, and it must not appear in what we log about
    // having removed it.
    expect(JSON.stringify(run)).not.toContain(USER_A);
  }, 180000);

  afterAll(async () => {
    await cleanup();
    await prisma.$disconnect();
  });

  it("settles the closure request it ran", async () => {
    const settled = await prisma.accountClosureRequest.findUnique({ where: { id: requestId } });
    expect(settled?.status).toBe(AccountClosureStatus.completed);
    expect(settled?.completedAt).toBeTruthy();
    // The request survives as the proof the erasure was asked for, but the free
    // text the person typed into it does not.
    expect(settled?.reason).toBeNull();
    expect(settled?.failureMessage).toBeNull();
    // The cascade moved it onto the rotated id.
    expect(settled?.userId).not.toBe(USER_A);
    expect(settled?.userId).toBe(newUserId);
  });

  it("leaves the wallet address nowhere it could identify an account", async () => {
    // The id itself.
    expect(await prisma.user.findUnique({ where: { id: USER_A } })).toBeNull();
    expect(
      await prisma.user.count({ where: { id: { contains: A_WALLET_LOWER, mode: "insensitive" } } }),
    ).toBe(0);

    // The email, which for a wallet account was `<address>@wallet.resonate`.
    const account = await prisma.user.findUnique({ where: { id: newUserId } });
    expect(account).not.toBeNull();
    expect(account?.email).toBe(`${newUserId}@${ERASED_EMAIL_DOMAIN}`);
    expect(account?.email.toLowerCase()).not.toContain(A_WALLET_LOWER);
    expect(account?.closedAt).toBeTruthy();
    expect(account?.erasedAt).toBeTruthy();

    // Every dangling column the cascade cannot reach.
    for (const count of [
      prisma.keyAuditLog.count({ where: { userId: { contains: A_WALLET_LOWER, mode: "insensitive" } } }),
      prisma.agentTransaction.count({
        where: { userId: { contains: A_WALLET_LOWER, mode: "insensitive" } },
      }),
      prisma.communityRoom.count({
        where: { ownerId: { contains: A_WALLET_LOWER, mode: "insensitive" } },
      }),
      prisma.showCampaignDispute.count({
        where: { resolvedByUserId: { contains: A_WALLET_LOWER, mode: "insensitive" } },
      }),
    ]) {
      expect(await count).toBe(0);
    }

    // Analytics, in all three keyings — including the checksummed casing that
    // an exact-match deletion would have walked straight past.
    expect(
      await prisma.analyticsEvent.count({
        where: {
          OR: [
            { actorId: { contains: A_WALLET_LOWER, mode: "insensitive" } },
            { subjectId: { contains: A_WALLET_LOWER, mode: "insensitive" } },
            { actorId: pseudonymousAnalyticsActorId(USER_A) },
          ],
        },
      }),
    ).toBe(0);
  });

  it("severs the address from the account without deleting what we must keep", async () => {
    // Nothing resolves the address back to a person any more.
    expect(await prisma.wallet.count({ where: { address: { equals: A_WALLET_CHECKSUMMED, mode: "insensitive" } } })).toBe(0);
    expect(await prisma.passkeyIdentity.count({ where: { id: id("passkey", "a") } })).toBe(0);
    expect(await prisma.signupFaucetAttempt.count({ where: { id: id("faucet", "a") } })).toBe(0);
    expect(await prisma.sessionKey.count({ where: { id: id("session_key", "a") } })).toBe(0);
    expect(await prisma.webAuthnCredential.count({ where: { id: id("webauthn", "a") } })).toBe(0);
    expect(await prisma.notification.count({ where: { id: id("notification", "a") } })).toBe(0);
    expect(
      await prisma.notificationPreference.count({ where: { walletAddress: A_WALLET_CHECKSUMMED } }),
    ).toBe(0);

    // The financial and audit rows stay, still keyed by the address.
    const royalty = await prisma.royaltyPayment.findUnique({ where: { id: id("royalty", "a") } });
    expect(royalty?.recipientAddress).toBe(A_WALLET_CHECKSUMMED);

    const agentTx = await prisma.agentTransaction.findUnique({ where: { id: id("agent_tx", "a") } });
    expect(agentTx).not.toBeNull();
    expect(agentTx?.userId).toBe(newUserId);

    const audit = await prisma.keyAuditLog.findUnique({ where: { id: id("key_audit", "a") } });
    expect(audit?.userId).toBe(newUserId);

    const session = await prisma.session.findUnique({ where: { id: id("session", "a") } });
    expect(session).not.toBeNull();
  });

  it("detaches the artist and withdraws the catalogue instead of deleting it", async () => {
    const artist = await prisma.artist.findUnique({ where: { id: id("artist", "a") } });
    expect(artist).not.toBeNull();
    expect(artist?.userId).toBeNull();
    // No later payout may route to the erased person's wallet.
    expect(artist?.payoutAddress).toBeNull();
    // The catalogue is published under this name, so it stays.
    expect(artist?.displayName).toBe(`${TEST_PREFIX}artist_a`);

    const release = await prisma.release.findUnique({ where: { id: id("release", "a") } });
    expect(release).not.toBeNull();
    expect(release?.status).toBe("withdrawn");
    // #1793: the pre-withdrawal status is recorded so a restore puts it back
    // where it was rather than silently unpublishing it.
    expect(release?.statusBeforeWithdrawal).toBe("published");
    expect(release?.withdrawnAt).toBeTruthy();

    // What the buyer bought still resolves, all the way down.
    const purchase = await prisma.stemPurchase.findUnique({
      where: { id: id("purchase", "b_buys_a") },
      include: { listing: { include: { stem: { include: { track: true } } } } },
    });
    expect(purchase?.buyerAddress).toBe(B_WALLET_CHECKSUMMED);
    expect(purchase?.listing.stem?.track.id).toBe(id("track", "a"));
  });

  it("empties the scrubbed columns and keeps the rows around them", async () => {
    const profile = await prisma.communityProfile.findUnique({ where: { id: id("profile", "a") } });
    expect(profile).not.toBeNull();
    expect(profile?.displayName).toBe("");
    expect(profile?.bio).toBeNull();
    expect(profile?.avatarUrl).toBeNull();

    // Other people's threads still render, with nothing of the author left.
    const message = await prisma.communityMessage.findUnique({ where: { id: id("message", "a") } });
    expect(message).not.toBeNull();
    expect(message?.body).toBe("");

    const playlist = await prisma.playlist.findUnique({ where: { id: id("playlist", "a") } });
    expect(playlist?.name).toBe("");
    // A kept playlist must not stay publicly browsable under an erased account.
    expect(playlist?.visibility).toBe("private");

    const folder = await prisma.folder.findUnique({ where: { id: id("folder", "a") } });
    expect(folder?.name).toBe("");

    const agentConfig = await prisma.agentConfig.findUnique({ where: { id: id("agent_config", "a") } });
    expect(agentConfig).not.toBeNull();
    expect(agentConfig?.learnedTasteProfile).toBeNull();
    expect(agentConfig?.name).toBe("My DJ");

    const libraryTrack = await prisma.libraryTrack.findUnique({
      where: { id: id("library_track", "a") },
    });
    // The path on the person's own computer is the most identifying column here.
    expect(libraryTrack?.sourcePath).toBeNull();
    expect(libraryTrack?.title).toBe("");
    // Ownership of a purchased edition stays consistent with the retained
    // StemPurchase.
    expect(libraryTrack?.isOwned).toBe(true);

    // Keyed by an address stored checksummed while the resolver returns
    // lowercase: a case-sensitive match would have missed this row entirely.
    const curator = await prisma.curatorReputation.findUnique({ where: { id: id("curator", "a") } });
    expect(curator).not.toBeNull();
    expect(curator?.verifiedHuman).toBe(false);
    expect(curator?.humanVerificationProvider).toBeNull();
    expect(curator?.humanVerificationStatus).toBe("unverified");
    // The abuse counters survive: closing an account cannot reset a curator's
    // record.
    expect(curator?.score).toBe(42);
    expect(curator?.reportsFiled).toBe(3);
  });

  it("scrubs on the column the rule names, not on whichever one matches", async () => {
    const initiated = await prisma.showCampaignDispute.findUnique({
      where: { id: id("dispute", "a_initiated") },
    });
    // A's own account of the dispute goes.
    expect(initiated?.reason).toBeNull();
    // The operator's record of a money decision does not.
    expect(initiated?.operatorNote).toBe(`${TEST_PREFIX}operator_note_on_a`);

    const resolvedByA = await prisma.showCampaignDispute.findUnique({
      where: { id: id("dispute", "b_initiated") },
    });
    // B wrote this. Matching on `resolvedByUserId` would have erased it.
    expect(resolvedByA?.reason).toBe(`${TEST_PREFIX}dispute_reason_b`);
    // The dangling resolver id is still rewritten.
    expect(resolvedByA?.resolvedByUserId).toBe(newUserId);
    expect(resolvedByA?.initiatorUserId).toBe(USER_B);
  });

  it("does not touch the other person", async () => {
    const other = await prisma.user.findUnique({ where: { id: USER_B } });
    expect(other?.email).toBe(`${USER_B}@wallet.resonate`);
    expect(other?.erasedAt).toBeNull();

    expect(await prisma.wallet.count({ where: { id: id("wallet", "b") } })).toBe(1);
    expect(await prisma.notification.count({ where: { id: id("notification", "b") } })).toBe(1);
    expect(
      await prisma.notificationPreference.count({ where: { walletAddress: B_WALLET_CHECKSUMMED } }),
    ).toBe(1);

    const curator = await prisma.curatorReputation.findUnique({ where: { id: id("curator", "b") } });
    expect(curator?.verifiedHuman).toBe(true);
    expect(curator?.humanVerificationStatus).toBe("verified");

    const message = await prisma.communityMessage.findUnique({ where: { id: id("message", "b") } });
    expect(message?.body).toBe(`${TEST_PREFIX}message_body_b`);

    const release = await prisma.release.findUnique({ where: { id: id("release", "b") } });
    expect(release?.status).toBe("published");

    expect(await prisma.analyticsEvent.count({ where: { id: { startsWith: TEST_PREFIX }, actorId: USER_B } })).toBe(1);
    expect(
      await prisma.analyticsEvent.count({
        where: { id: { startsWith: TEST_PREFIX }, actorId: pseudonymousAnalyticsActorId(USER_B) },
      }),
    ).toBe(1);
    expect(await prisma.sessionKey.count({ where: { id: id("session_key", "b") } })).toBe(1);
  });

  it("records the deletion in the lineage the governance service owns", async () => {
    // #1770's AnalyticsGovernanceService writes one lineage row per erased
    // event so a deletion stays provable, plus a warehouse-erasure summary.
    const lineage = await prisma.analyticsGovernanceLog.findMany({
      where: { eventId: { startsWith: TEST_PREFIX }, reason: "account_erasure" },
    });
    expect(lineage.length).toBe(3);

    // The lineage must not become a fresh copy of what the erasure removed.
    // `governanceLogData` used to write the erased event's `actorId` and
    // `subjectId` verbatim, and bridge-emitted events carry the raw user id —
    // which for a wallet account is the address — so the deletion log kept the
    // address after an erasure that reported success. It is now pseudonymized
    // at the log writer, address-shaped values only.
    const raw = lineage.filter(
      (row) =>
        row.actorId?.toLowerCase() === A_WALLET_LOWER ||
        row.subjectId?.toLowerCase() === A_WALLET_LOWER,
    );
    expect(raw).toEqual([]);

    // Still provable, though: the rows are there and correlate through the
    // stable pseudonym. An audit trail nobody can read is not an audit trail.
    const pseudonym = pseudonymousAnalyticsActorId(A_WALLET_LOWER);
    expect(lineage.some((row) => row.actorId === pseudonym || row.subjectId === pseudonym)).toBe(true);

    // A non-person subject is left alone — hashing a release id would make the
    // lineage unreadable for no privacy gain.
    expect(
      lineage.every((row) => !row.subjectId || !/^0x[0-9a-f]{40}$/i.test(row.subjectId)),
    ).toBe(true);
  });

  it("is a no-op when run again", async () => {
    const again = await service.eraseAccount(newUserId);
    expect(again.status).toBe("already_erased");
    expect(again.newUserId).toBe(newUserId);

    // Nothing moved: the id did not rotate a second time and the retained rows
    // are where the first pass left them.
    const account = await prisma.user.findUnique({ where: { id: newUserId } });
    expect(account?.email).toBe(`${newUserId}@${ERASED_EMAIL_DOMAIN}`);
    const audit = await prisma.keyAuditLog.findUnique({ where: { id: id("key_audit", "a") } });
    expect(audit?.userId).toBe(newUserId);
  });

  it("erases the second person too, without disturbing the first", async () => {
    const second = await service.eraseAccount(USER_B);
    expect(second.status).toBe("erased");

    expect(await prisma.user.findUnique({ where: { id: USER_B } })).toBeNull();
    expect(await prisma.notification.count({ where: { id: id("notification", "b") } })).toBe(0);
    expect(
      await prisma.analyticsEvent.count({
        where: {
          id: { startsWith: TEST_PREFIX },
          OR: [
            { actorId: { contains: B_WALLET_LOWER, mode: "insensitive" } },
            { subjectId: { contains: B_WALLET_LOWER, mode: "insensitive" } },
            { actorId: pseudonymousAnalyticsActorId(USER_B) },
          ],
        },
      }),
    ).toBe(0);

    // The first person's erased state is untouched by the second erasure.
    const first = await prisma.user.findUnique({ where: { id: newUserId } });
    expect(first?.email).toBe(`${newUserId}@${ERASED_EMAIL_DOMAIN}`);
    const audit = await prisma.keyAuditLog.findUnique({ where: { id: id("key_audit", "a") } });
    expect(audit?.userId).toBe(newUserId);
    // B's purchase of A's stem is a financial record on both sides and stays.
    const purchase = await prisma.stemPurchase.findUnique({
      where: { id: id("purchase", "b_buys_a") },
    });
    expect(purchase?.buyerAddress).toBe(B_WALLET_CHECKSUMMED);
  });
});
