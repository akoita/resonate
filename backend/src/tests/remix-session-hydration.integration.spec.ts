/**
 * Remix Full-Session Hydration (#1312) — Integration Test (Testcontainers)
 *
 * Covers the P0 slice of epic #1311 against real Postgres:
 *  - creation hydration: a stem-scoped entry auto-adds every individually
 *    eligible sibling stem (explicit unmuted, hydrated muted), excluding
 *    non-remixable mints, unlicensed stems, and full-mix (original/master)
 *    types;
 *  - sibling availability on draft reads ("Also on this track" panel data);
 *  - PATCH addStemIds: strict eligibility on additions, duplicates rejected,
 *    published projects stay locked.
 *
 * Run: npm run test:integration
 */

import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import { RemixProjectService } from "../modules/remix/remix-project.service";
import { stubGenerationCredits } from "./e2e-helpers";
import { StubRemixGenerationProvider } from "../modules/remix/remix-generation.provider";

const TEST_PREFIX = `remixhyd_${Date.now()}_`;

// Owns the artist profile (#1174): licensed for all stems by ownership.
const OWNER_ID = `${TEST_PREFIX}owner`;
// Bought a remix license for the vocals stem only.
const BUYER_ID = `${TEST_PREFIX}buyer`;
const BUYER_WALLET = `0x${"d4".repeat(20)}`;
// Bought remix licenses for vocals AND drums (PATCH-addition persona).
const BUYER2_ID = `${TEST_PREFIX}buyer2`;
const BUYER2_WALLET = `0x${"e5".repeat(20)}`;

const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const VOCALS_STEM_ID = `${TEST_PREFIX}stem_vocals`;
const DRUMS_STEM_ID = `${TEST_PREFIX}stem_drums`;
const LOCKED_STEM_ID = `${TEST_PREFIX}stem_locked`;
const ORIGINAL_STEM_ID = `${TEST_PREFIX}stem_original`;

const storageProvider = {
  upload: jest.fn(),
  download: jest.fn(),
  downloadRange: jest.fn(),
  delete: jest.fn(),
};
const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };
const stemMixRenderer = { render: jest.fn() };

async function mint(stemId: string, tokenId: number, remixable: boolean) {
  await prisma.stemNftMint.create({
    data: {
      stemId,
      tokenId: BigInt(tokenId),
      chainId: 31337,
      contractAddress: `0x${"c3".repeat(20)}`,
      creatorAddress: `0x${"b2".repeat(20)}`,
      royaltyBps: 500,
      remixable,
      metadataUri: `ipfs://${stemId}`,
      transactionHash: `${TEST_PREFIX}mint_${tokenId}`,
      blockNumber: BigInt(tokenId),
      mintedAt: new Date(),
    },
  });
}

async function remixPurchase(
  stemId: string,
  tokenId: number,
  listingId: number,
  buyerAddress: string,
) {
  const listing = await prisma.stemListing.create({
    data: {
      listingId: BigInt(listingId),
      stemId,
      tokenId: BigInt(tokenId),
      chainId: 31337,
      contractAddress: `0x${"c3".repeat(20)}`,
      sellerAddress: `0x${"b2".repeat(20)}`,
      pricePerUnit: "1000000",
      amount: BigInt(10),
      paymentToken: `0x${"0".repeat(40)}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      transactionHash: `${TEST_PREFIX}list_${listingId}`,
      blockNumber: BigInt(listingId),
      licenseType: "remix",
      status: "active",
      listedAt: new Date(),
    },
  });
  await prisma.stemPurchase.create({
    data: {
      listingId: listing.id,
      buyerAddress,
      amount: BigInt(1),
      totalPaid: "1000000",
      royaltyPaid: "0",
      protocolFeePaid: "0",
      sellerReceived: "1000000",
      licenseType: "remix",
      transactionHash: `${TEST_PREFIX}buy_${listingId}`,
      blockNumber: BigInt(listingId + 1),
      purchasedAt: new Date(),
    },
  });
}

describe("Remix full-session hydration (#1312, integration)", () => {
  let projectService: RemixProjectService;
  let eventBus: EventBus;
  const projectEvents: Array<Record<string, unknown>> = [];

  beforeAll(async () => {
    for (const [id, label] of [
      [OWNER_ID, "owner"],
      [BUYER_ID, "buyer"],
      [BUYER2_ID, "buyer2"],
    ] as const) {
      await prisma.user.create({
        data: { id, email: `${TEST_PREFIX}${label}@test.resonate` },
      });
    }
    await prisma.wallet.create({
      data: { userId: BUYER_ID, address: BUYER_WALLET, chainId: 31337 },
    });
    await prisma.wallet.create({
      data: { userId: BUYER2_ID, address: BUYER2_WALLET, chainId: 31337 },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: OWNER_ID,
        displayName: "Hydration Artist",
        payoutAddress: `0x${"b2".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Hydration Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "Hydration Track",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.createMany({
      data: [
        { id: VOCALS_STEM_ID, trackId: TRACK_ID, type: "vocals", uri: "local://v" },
        { id: DRUMS_STEM_ID, trackId: TRACK_ID, type: "drums", uri: "local://d" },
        { id: LOCKED_STEM_ID, trackId: TRACK_ID, type: "bass", uri: "local://b" },
        // Full mixdown: never volunteered by hydration or the panel.
        { id: ORIGINAL_STEM_ID, trackId: TRACK_ID, type: "original", uri: "local://o" },
      ],
    });
    await mint(VOCALS_STEM_ID, 9101, true);
    await mint(DRUMS_STEM_ID, 9102, true);
    await mint(LOCKED_STEM_ID, 9103, false);
    await remixPurchase(VOCALS_STEM_ID, 9101, 7101, BUYER_WALLET);
    await remixPurchase(VOCALS_STEM_ID, 9101, 7102, BUYER2_WALLET);
    await remixPurchase(DRUMS_STEM_ID, 9102, 7103, BUYER2_WALLET);
  });

  afterAll(async () => {
    await prisma.remixProjectStem.deleteMany({
      where: { project: { sourceTrackId: TRACK_ID } },
    });
    await prisma.remixProject.deleteMany({ where: { sourceTrackId: TRACK_ID } });
    await prisma.stemPurchase.deleteMany({
      where: { listing: { stemId: { in: [VOCALS_STEM_ID, DRUMS_STEM_ID] } } },
    });
    await prisma.stemListing.deleteMany({
      where: { stemId: { in: [VOCALS_STEM_ID, DRUMS_STEM_ID] } },
    });
    await prisma.stemNftMint.deleteMany({
      where: { stemId: { in: [VOCALS_STEM_ID, DRUMS_STEM_ID, LOCKED_STEM_ID] } },
    });
    await prisma.stem.deleteMany({ where: { trackId: TRACK_ID } });
    await prisma.track.deleteMany({ where: { id: TRACK_ID } });
    await prisma.release.deleteMany({ where: { id: `${TEST_PREFIX}release` } });
    await prisma.artist.deleteMany({ where: { id: ARTIST_ID } });
    await prisma.wallet.deleteMany({
      where: { userId: { in: [BUYER_ID, BUYER2_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [OWNER_ID, BUYER_ID, BUYER2_ID] } },
    });
    eventBus.destroy();
  });

  beforeEach(() => {
    if (!eventBus) {
      eventBus = new EventBus();
      eventBus.subscribe("remix.project_created", (event) =>
        projectEvents.push(event as unknown as Record<string, unknown>),
      );
    }
    projectEvents.length = 0;
    projectService = new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      new StubRemixGenerationProvider(),
      stemMixRenderer as never,
      storageProvider as never,
      generationQueue as never,
      stubGenerationCredits() as never,
    );
  });

  it("hydrates an owner's stem-scoped project with every eligible sibling, muted", async () => {
    const project = await projectService.createProject({
      userId: OWNER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [VOCALS_STEM_ID],
      title: "Owner session",
    });

    const byId = new Map(project.stems.map((stem) => [stem.stemId, stem]));
    // Explicit selection is unmuted; the licensed sibling arrives muted.
    expect(byId.get(VOCALS_STEM_ID)?.muted).toBe(false);
    expect(byId.get(DRUMS_STEM_ID)?.muted).toBe(true);
    // Non-remixable mint and the full mixdown are never volunteered.
    expect(byId.has(LOCKED_STEM_ID)).toBe(false);
    expect(byId.has(ORIGINAL_STEM_ID)).toBe(false);
    expect(project.stems).toHaveLength(2);

    // Analytics contract: the created event still carries the EXPLICIT
    // selection, not the hydrated set.
    const created = projectEvents.find(
      (event) => event.remixProjectId === project.id,
    );
    expect(created?.stemIds).toEqual([VOCALS_STEM_ID]);
  });

  it("hydrates only stems the creator is licensed for", async () => {
    const project = await projectService.createProject({
      userId: BUYER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [VOCALS_STEM_ID],
      title: "Buyer session",
    });
    // Drums is remixable but the buyer holds no license for it.
    expect(project.stems.map((stem) => stem.stemId)).toEqual([VOCALS_STEM_ID]);
  });

  it("reports sibling availability on draft reads, excluding full-mix stems", async () => {
    const created = await projectService.createProject({
      userId: BUYER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [VOCALS_STEM_ID],
      title: "Buyer availability",
    });
    const project = await projectService.getProject(BUYER_ID, created.id);
    const available = (project as { availableStems?: Array<Record<string, unknown>> })
      .availableStems!;
    expect(available).toBeDefined();

    const byId = new Map(available.map((stem) => [stem.stemId, stem]));
    // Unlicensed remixable sibling: license path with the minted token id.
    expect(byId.get(DRUMS_STEM_ID)).toMatchObject({
      licensed: false,
      remixable: true,
      addable: false,
      tokenId: "9102",
      type: "drums",
    });
    // Non-remixable mint: honestly blocked.
    expect(byId.get(LOCKED_STEM_ID)).toMatchObject({
      remixable: false,
      addable: false,
    });
    // Already in the project / full mixdown: not listed.
    expect(byId.has(VOCALS_STEM_ID)).toBe(false);
    expect(byId.has(ORIGINAL_STEM_ID)).toBe(false);
  });

  it("denies adding a stem the user is not licensed for", async () => {
    const created = await projectService.createProject({
      userId: BUYER_ID,
      sourceTrackId: TRACK_ID,
      stemIds: [VOCALS_STEM_ID],
      title: "Buyer add denied",
    });
    await expect(
      projectService.updateProject(BUYER_ID, created.id, {
        addStemIds: [DRUMS_STEM_ID],
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it("adds a licensed stem to a legacy one-channel project, unmuted", async () => {
    // Legacy shape (pre-hydration): created directly, one stem only.
    const legacy = await prisma.remixProject.create({
      data: {
        creatorUserId: BUYER2_ID,
        sourceTrackId: TRACK_ID,
        title: "Legacy session",
        mode: "stem_mix",
        policyVersion: "test",
        stems: { create: [{ stemId: VOCALS_STEM_ID }] },
      },
    });

    // The panel offers drums as addable for this licensed buyer.
    const before = (await projectService.getProject(
      BUYER2_ID,
      legacy.id,
    )) as { availableStems?: Array<{ stemId: string; addable: boolean }> };
    expect(
      before.availableStems?.find((stem) => stem.stemId === DRUMS_STEM_ID)
        ?.addable,
    ).toBe(true);

    const updated = await projectService.updateProject(BUYER2_ID, legacy.id, {
      addStemIds: [DRUMS_STEM_ID],
    });
    const drums = updated.stems.find((stem) => stem.stemId === DRUMS_STEM_ID);
    expect(drums).toBeDefined();
    expect(drums?.muted).toBe(false); // explicit intent → audible immediately

    // Duplicate additions are rejected.
    await expect(
      projectService.updateProject(BUYER2_ID, legacy.id, {
        addStemIds: [DRUMS_STEM_ID],
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it("omits availableStems for published projects (locked)", async () => {
    const published = await prisma.remixProject.create({
      data: {
        creatorUserId: OWNER_ID,
        sourceTrackId: TRACK_ID,
        title: "Published session",
        mode: "stem_mix",
        status: "published",
        policyVersion: "test",
        stems: { create: [{ stemId: VOCALS_STEM_ID }] },
      },
    });
    const project = (await projectService.getProject(
      OWNER_ID,
      published.id,
    )) as { availableStems?: unknown };
    expect(project.availableStems).toBeUndefined();
  });
});
