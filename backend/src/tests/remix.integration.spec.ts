/**
 * Remix Eligibility + Remix Projects — Integration Test (Testcontainers)
 *
 * Tests RemixEligibilityService and RemixProjectService against real Postgres.
 * Covers rights-route/content-status gating, mint remixability, remix license
 * detection through StemPurchase and X402Settlement, durable project
 * create/read/update, ownership enforcement, and policy denial events.
 *
 * Run: npm run test:integration
 */

import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import { RemixProjectService } from "../modules/remix/remix-project.service";
import { HttpException } from "@nestjs/common";
import { StubRemixGenerationProvider } from "../modules/remix/remix-generation.provider";
import { REMIX_RENDER_AUDIO_POLICY } from "../modules/remix/stem-audio-mixer";

const TEST_PREFIX = `remix_${Date.now()}_`;

const CREATOR_ID = `${TEST_PREFIX}creator`;
const OTHER_USER_ID = `${TEST_PREFIX}other`;
// Owns the artist profile (#1174). Distinct from CREATOR_ID, which is the
// licensed *buyer* persona — conflating them would let the owner bypass
// satisfy license-proof tests vacuously.
const ARTIST_OWNER_ID = `${TEST_PREFIX}artist_owner`;
const CREATOR_WALLET = `0x${"a1".repeat(20)}`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const TRACK_ID = `${TEST_PREFIX}track`;
const BLOCKED_TRACK_ID = `${TEST_PREFIX}track_blocked`;
const QUARANTINED_TRACK_ID = `${TEST_PREFIX}track_quarantined`;
const LICENSED_STEM_ID = `${TEST_PREFIX}stem_licensed`;
const UNLICENSED_STEM_ID = `${TEST_PREFIX}stem_unlicensed`;
const NON_REMIXABLE_STEM_ID = `${TEST_PREFIX}stem_locked`;
const X402_STEM_ID = `${TEST_PREFIX}stem_x402`;
const FAILED_X402_STEM_ID = `${TEST_PREFIX}stem_x402_failed`;
const BLOCKED_STEM_ID = `${TEST_PREFIX}stem_blocked`;
const QUARANTINED_STEM_ID = `${TEST_PREFIX}stem_quarantined`;
const storageProvider = {
  upload: jest.fn(),
  download: jest.fn(),
  downloadRange: jest.fn(),
  delete: jest.fn(),
};
const generationQueue = {
  add: jest.fn().mockResolvedValue({ id: "queued" }),
};
// stem_mix render path (#1189): integration tests inject a fake renderer;
// the real ffmpeg execution has its own unit/smoke coverage.
const stemMixRenderer = {
  render: jest.fn().mockResolvedValue({
    jobId: "render-job",
    provider: "stem-mix-render",
    estimatedCostUsd: 0,
    sourceArrangement: [
      { stemId: LICENSED_STEM_ID, gainDb: null, muted: false },
    ],
    renderMetadata: {
      ...REMIX_RENDER_AUDIO_POLICY,
      inputCount: 1,
      activeStemCount: 1,
    },
    outputMetadata: {
      outputUri: "local://remix-draft-render.mp3",
      mimeType: "audio/mpeg",
      synthIdPresent: false,
      seed: null,
      sampleRate: null,
    },
  }),
};
const layeredRenderer = {
  render: jest.fn(),
};

describe("Remix eligibility and projects (integration)", () => {
  let eligibilityService: RemixEligibilityService;
  let projectService: RemixProjectService;
  let eventBus: EventBus;
  let publishSpy: jest.SpyInstance;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: CREATOR_ID, email: `${TEST_PREFIX}creator@test.resonate` },
    });
    await prisma.user.create({
      data: { id: OTHER_USER_ID, email: `${TEST_PREFIX}other@test.resonate` },
    });
    await prisma.user.create({
      data: {
        id: ARTIST_OWNER_ID,
        email: `${TEST_PREFIX}artist_owner@test.resonate`,
      },
    });
    await prisma.wallet.create({
      data: { userId: CREATOR_ID, address: CREATOR_WALLET, chainId: 31337 },
    });
    await prisma.artist.create({
      data: {
        id: ARTIST_ID,
        userId: ARTIST_OWNER_ID,
        displayName: "Remix Test Artist",
        payoutAddress: `0x${"b2".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: ARTIST_ID,
        title: "Remixable Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: TRACK_ID,
        releaseId: release.id,
        title: "Remixable Track",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: BLOCKED_TRACK_ID,
        releaseId: release.id,
        title: "Blocked Track",
        position: 2,
        contentStatus: "clean",
        rightsRoute: "BLOCKED",
      },
    });
    await prisma.track.create({
      data: {
        id: QUARANTINED_TRACK_ID,
        releaseId: release.id,
        title: "Quarantined Track",
        position: 3,
        contentStatus: "quarantined",
        rightsRoute: "STANDARD_ESCROW",
      },
    });

    await prisma.stem.createMany({
      data: [
        {
          id: LICENSED_STEM_ID,
          trackId: TRACK_ID,
          type: "vocals",
          uri: "local://licensed",
          // Worker-measured features (#1184): exposed on project reads.
          audioFeatures: {
            schemaVersion: "stem-audio-features/v1",
            extractor: { name: "librosa", version: "0.10.2" },
            tempoBpm: 92.5,
            key: { tonic: "G", mode: "minor", confidence: 0.7 },
            energyRms: 0.08,
          },
        },
        { id: UNLICENSED_STEM_ID, trackId: TRACK_ID, type: "drums", uri: "local://unlicensed" },
        { id: NON_REMIXABLE_STEM_ID, trackId: TRACK_ID, type: "bass", uri: "local://locked" },
        { id: X402_STEM_ID, trackId: TRACK_ID, type: "other", uri: "local://x402" },
        { id: FAILED_X402_STEM_ID, trackId: TRACK_ID, type: "fx", uri: "local://x402-failed" },
        { id: BLOCKED_STEM_ID, trackId: BLOCKED_TRACK_ID, type: "vocals", uri: "local://blocked" },
        { id: QUARANTINED_STEM_ID, trackId: QUARANTINED_TRACK_ID, type: "vocals", uri: "local://quarantined" },
      ],
    });

    // Mint metadata: licensed stem is remixable, locked stem is not.
    await prisma.stemNftMint.create({
      data: {
        stemId: LICENSED_STEM_ID,
        tokenId: BigInt(9001),
        chainId: 31337,
        contractAddress: `0x${"c3".repeat(20)}`,
        creatorAddress: `0x${"b2".repeat(20)}`,
        royaltyBps: 500,
        remixable: true,
        metadataUri: "ipfs://remixable",
        transactionHash: `${TEST_PREFIX}mint_licensed`,
        blockNumber: BigInt(100),
        mintedAt: new Date(),
      },
    });
    await prisma.stemNftMint.create({
      data: {
        stemId: NON_REMIXABLE_STEM_ID,
        tokenId: BigInt(9002),
        chainId: 31337,
        contractAddress: `0x${"c3".repeat(20)}`,
        creatorAddress: `0x${"b2".repeat(20)}`,
        royaltyBps: 500,
        remixable: false,
        metadataUri: "ipfs://locked",
        transactionHash: `${TEST_PREFIX}mint_locked`,
        blockNumber: BigInt(101),
        mintedAt: new Date(),
      },
    });

    // Remix license via marketplace purchase. Buyer address is uppercase to
    // prove wallet matching is case-insensitive.
    const remixListing = await prisma.stemListing.create({
      data: {
        listingId: BigInt(7001),
        stemId: LICENSED_STEM_ID,
        tokenId: BigInt(9001),
        chainId: 31337,
        contractAddress: `0x${"c3".repeat(20)}`,
        sellerAddress: `0x${"b2".repeat(20)}`,
        pricePerUnit: "1000000",
        amount: BigInt(10),
        paymentToken: `0x${"0".repeat(40)}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        transactionHash: `${TEST_PREFIX}list_remix`,
        blockNumber: BigInt(102),
        licenseType: "remix",
        status: "active",
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: remixListing.id,
        buyerAddress: CREATOR_WALLET.toUpperCase().replace("0X", "0x"),
        amount: BigInt(1),
        totalPaid: "1000000",
        royaltyPaid: "0",
        protocolFeePaid: "0",
        sellerReceived: "1000000",
        licenseType: "remix",
        transactionHash: `${TEST_PREFIX}buy_remix`,
        blockNumber: BigInt(103),
        purchasedAt: new Date(),
      },
    });

    // Remix license via listing-backed x402 settlement for a second stem.
    const x402Listing = await prisma.stemListing.create({
      data: {
        listingId: BigInt(7002),
        stemId: X402_STEM_ID,
        tokenId: BigInt(9003),
        chainId: 31337,
        contractAddress: `0x${"c3".repeat(20)}`,
        sellerAddress: `0x${"b2".repeat(20)}`,
        pricePerUnit: "2000000",
        amount: BigInt(5),
        paymentToken: `0x${"0".repeat(40)}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        transactionHash: `${TEST_PREFIX}list_x402`,
        blockNumber: BigInt(104),
        licenseType: "remix",
        status: "active",
        listedAt: new Date(),
      },
    });
    await prisma.x402Settlement.create({
      data: {
        stemId: X402_STEM_ID,
        listingId: x402Listing.id,
        payerAddress: CREATOR_WALLET,
        receiptId: `${TEST_PREFIX}receipt`,
        receipt: { kind: "test" },
        paymentToken: `0x${"0".repeat(40)}`,
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        settlementAmount: "2.00",
        settlementAmountUnits: "2000000",
        purchasedAt: new Date(),
      },
    });

    // A failed listing settlement must NOT count as a remix license, even
    // though the listing carries licenseType=remix and the payer matches.
    const failedX402Listing = await prisma.stemListing.create({
      data: {
        listingId: BigInt(7003),
        stemId: FAILED_X402_STEM_ID,
        tokenId: BigInt(9004),
        chainId: 31337,
        contractAddress: `0x${"c3".repeat(20)}`,
        sellerAddress: `0x${"b2".repeat(20)}`,
        pricePerUnit: "2000000",
        amount: BigInt(5),
        paymentToken: `0x${"0".repeat(40)}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        transactionHash: `${TEST_PREFIX}list_x402_failed`,
        blockNumber: BigInt(105),
        licenseType: "remix",
        status: "active",
        listedAt: new Date(),
      },
    });
    await prisma.x402Settlement.create({
      data: {
        stemId: FAILED_X402_STEM_ID,
        listingId: failedX402Listing.id,
        payerAddress: CREATOR_WALLET,
        receiptId: `${TEST_PREFIX}receipt_failed`,
        receipt: { kind: "test" },
        status: "contract_settlement_failed",
        contractSettlementStatus: "contract_failed",
        paymentToken: `0x${"0".repeat(40)}`,
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        settlementAmount: "2.00",
        settlementAmountUnits: "2000000",
        purchasedAt: new Date(),
      },
    });
  });

  afterAll(async () => {
    await prisma.remixProject.deleteMany({
      where: {
        creatorUserId: { in: [CREATOR_ID, OTHER_USER_ID, ARTIST_OWNER_ID] },
      },
    });
    await prisma.x402Settlement.deleteMany({
      where: { receiptId: { startsWith: TEST_PREFIX } },
    });
    await prisma.stemPurchase.deleteMany({
      where: { transactionHash: { startsWith: TEST_PREFIX } },
    });
    await prisma.stemListing.deleteMany({
      where: { transactionHash: { startsWith: TEST_PREFIX } },
    });
    await prisma.stemNftMint.deleteMany({
      where: { transactionHash: { startsWith: TEST_PREFIX } },
    });
    await prisma.stem.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.release.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.artist.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.wallet.deleteMany({
      where: { userId: { in: [CREATOR_ID, OTHER_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [CREATOR_ID, OTHER_USER_ID, ARTIST_OWNER_ID] } },
    });
  });

  beforeEach(() => {
    eligibilityService = new RemixEligibilityService();
    eventBus = new EventBus();
    publishSpy = jest.spyOn(eventBus, "publish");
    projectService = new RemixProjectService(
      eventBus,
      eligibilityService,
      new StubRemixGenerationProvider(),
      stemMixRenderer,
      storageProvider,
      generationQueue as any,
    );
    generationQueue.add.mockClear();
    layeredRenderer.render.mockReset();
    storageProvider.download.mockResolvedValue(Buffer.from("draft audio"));
  });

  describe("eligibility", () => {
    it("allows private drafts for a licensed stem on a standard route", async () => {
      const artist = await prisma.artist.findUnique({
        where: { id: ARTIST_ID },
        select: { remixConsent: true },
      });
      expect(artist?.remixConsent).toBe("allowed");

      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
      });
      expect(result.allowed).toBe(true);
      expect(result.allowedActions).toEqual(["private_draft", "publish_resonate"]);
      expect(result.stems).toEqual([
        { stemId: LICENSED_STEM_ID, remixable: true, licensed: true },
      ]);
      expect(result.source.rightsRoute).toBe("STANDARD_ESCROW");
    });

    it("denies and restores eligibility when the source artist toggles remix consent", async () => {
      await prisma.artist.update({
        where: { id: ARTIST_ID },
        data: { remixConsent: "disabled" },
      });
      const disabled = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
      });
      expect(disabled.allowed).toBe(false);
      expect(disabled.requiredLicense).toBeNull();
      expect(disabled.reasons.map((reason) => reason.code)).toEqual([
        "artist_remix_disabled",
      ]);

      await prisma.artist.update({
        where: { id: ARTIST_ID },
        data: { remixConsent: "allowed" },
      });
      const restored = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
      });
      expect(restored.allowed).toBe(true);
    });

    it("treats the artist owner as licensed for their own stems without a purchase (#1174)", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: ARTIST_OWNER_ID,
        trackId: TRACK_ID,
        stemIds: [UNLICENSED_STEM_ID],
      });
      expect(result.allowed).toBe(true);
      expect(result.creatorOwner).toBe(true);
      expect(result.requiredLicense).toBeNull();
      expect(result.stems).toEqual([
        { stemId: UNLICENSED_STEM_ID, remixable: null, licensed: true },
      ]);
    });

    it("marks non-owners with creatorOwner=false", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
      });
      expect(result.creatorOwner).toBe(false);
    });

    it("ownership does not bypass non-remixable mints", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: ARTIST_OWNER_ID,
        trackId: TRACK_ID,
        stemIds: [NON_REMIXABLE_STEM_ID],
      });
      expect(result.allowed).toBe(false);
      expect(result.creatorOwner).toBe(true);
      expect(result.reasons.map((reason) => reason.code)).toContain(
        "stem_not_remixable",
      );
    });

    it("ownership does not bypass quarantined sources", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: ARTIST_OWNER_ID,
        trackId: QUARANTINED_TRACK_ID,
      });
      expect(result.allowed).toBe(false);
      expect(result.creatorOwner).toBe(true);
      expect(result.reasons.map((reason) => reason.code)).toContain(
        "source_quarantined",
      );
    });

    it("ownership does not bypass the artist's own disabled remix consent", async () => {
      await prisma.artist.update({
        where: { id: ARTIST_ID },
        data: { remixConsent: "disabled" },
      });
      try {
        const result = await eligibilityService.checkEligibility({
          userId: ARTIST_OWNER_ID,
          trackId: TRACK_ID,
          stemIds: [UNLICENSED_STEM_ID],
        });
        expect(result.allowed).toBe(false);
        expect(result.creatorOwner).toBe(true);
        expect(result.reasons.map((reason) => reason.code)).toEqual([
          "artist_remix_disabled",
        ]);
      } finally {
        await prisma.artist.update({
          where: { id: ARTIST_ID },
          data: { remixConsent: "allowed" },
        });
      }
    });

    it("accepts listing-backed x402 settlements as remix licenses", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
        stemIds: [X402_STEM_ID],
      });
      expect(result.allowed).toBe(true);
      expect(result.stems[0].licensed).toBe(true);
    });

    it("rejects failed x402 listing settlements as remix licenses", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
        stemIds: [FAILED_X402_STEM_ID],
      });
      expect(result.allowed).toBe(false);
      expect(result.requiredLicense).toBe("remix");
      expect(result.stems[0].licensed).toBe(false);
    });

    it("allows track-default requests when at least one stem is licensed", async () => {
      // The release-page CTA path: no stem filter. The track has licensed,
      // unlicensed, and non-remixable stems — one licensed stem is enough.
      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
      });
      expect(result.allowed).toBe(true);
      const licensedIds = result.stems
        .filter((stem) => stem.licensed)
        .map((stem) => stem.stemId);
      expect(licensedIds).toEqual(
        expect.arrayContaining([LICENSED_STEM_ID, X402_STEM_ID]),
      );
      expect(
        result.stems.find((stem) => stem.stemId === UNLICENSED_STEM_ID)?.licensed,
      ).toBe(false);
    });

    it("requires a remix license for unlicensed stems", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
        stemIds: [UNLICENSED_STEM_ID],
      });
      expect(result.allowed).toBe(false);
      expect(result.requiredLicense).toBe("remix");
      expect(result.reasons.map((r) => r.code)).toEqual(["license_required"]);
    });

    it("denies stems minted as non-remixable", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
        stemIds: [NON_REMIXABLE_STEM_ID],
      });
      expect(result.allowed).toBe(false);
      expect(result.requiredLicense).toBeNull();
      expect(result.reasons.map((r) => r.code)).toContain("stem_not_remixable");
    });

    it("denies blocked sources", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: BLOCKED_TRACK_ID,
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons.map((r) => r.code)).toContain("source_blocked");
    });

    it("denies quarantined sources", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: QUARANTINED_TRACK_ID,
      });
      expect(result.allowed).toBe(false);
      expect(result.reasons.map((r) => r.code)).toContain("source_quarantined");
    });

    it("reports unlicensed for users without a wallet", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: OTHER_USER_ID,
        trackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
      });
      expect(result.allowed).toBe(false);
      expect(result.requiredLicense).toBe("remix");
    });

    it("404s for unknown tracks", async () => {
      await expect(
        eligibilityService.checkEligibility({
          userId: CREATOR_ID,
          trackId: `${TEST_PREFIX}missing`,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects stems that do not belong to the track", async () => {
      await expect(
        eligibilityService.checkEligibility({
          userId: CREATOR_ID,
          trackId: TRACK_ID,
          stemIds: [BLOCKED_STEM_ID],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("remix projects", () => {
    it("creates a durable project that survives a fresh service instance", async () => {
      const created = await projectService.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Neon Drift (Flip)",
        prompt: "darker, halftime",
      });
      expect(created.id).toBeDefined();
      expect(created.status).toBe("draft");
      expect(created.mode).toBe("stem_mix");
      expect(created.policyVersion).toBeTruthy();
      expect(created.stems).toEqual([
        expect.objectContaining({ stemId: LICENSED_STEM_ID, muted: false }),
      ]);
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "remix.project_created",
          remixProjectId: created.id,
          creatorId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          // Source-artist attribution (#1121): the warehouse aggregates this
          // fact under the artist whose track is being remixed.
          artistId: ARTIST_ID,
        }),
      );

      // Studio surfaces consume the public source summary and stem labels.
      expect(created.source).toEqual({
        trackId: TRACK_ID,
        trackTitle: "Remixable Track",
        releaseId: `${TEST_PREFIX}release`,
        releaseTitle: "Remixable Release",
        artistName: null,
        rightsRoute: "STANDARD_ESCROW",
        contentStatus: "clean",
      });
      expect(created.stems[0]).toEqual(
        expect.objectContaining({ type: "vocals" }),
      );
      // Worker-measured features (#1184) ride the project read shape so
      // grounding slices need no extra round-trips.
      expect(created.stems[0].audioFeatures).toEqual(
        expect.objectContaining({
          schemaVersion: "stem-audio-features/v1",
          tempoBpm: 92.5,
          key: expect.objectContaining({ tonic: "G", mode: "minor" }),
        }),
      );

      // Durability: a brand-new service instance reads the same record.
      const freshService = new RemixProjectService(
        new EventBus(),
        new RemixEligibilityService(),
        new StubRemixGenerationProvider(),
        stemMixRenderer,
        storageProvider,
        generationQueue as any,
      );
      const read = await freshService.getProject(CREATOR_ID, created.id);
      expect(read.title).toBe("Neon Drift (Flip)");
      expect(read.prompt).toBe("darker, halftime");
    });

    it("updates title, prompt, status, and stem controls", async () => {
      const created = await projectService.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID, X402_STEM_ID],
        title: "Two Stem Mix",
      });
      const updated = await projectService.updateProject(CREATOR_ID, created.id, {
        title: "Two Stem Mix v2",
        prompt: "brighter",
        status: "archived",
        stems: [
          { stemId: LICENSED_STEM_ID, gainDb: -3.5, muted: true, role: "lead" },
        ],
      });
      expect(updated.title).toBe("Two Stem Mix v2");
      expect(updated.status).toBe("archived");
      const lead = updated.stems.find((s) => s.stemId === LICENSED_STEM_ID);
      expect(lead).toEqual(
        expect.objectContaining({ gainDb: -3.5, muted: true, role: "lead" }),
      );
      const untouched = updated.stems.find((s) => s.stemId === X402_STEM_ID);
      expect(untouched).toEqual(expect.objectContaining({ muted: false }));
    });

    it("rejects non-finite and out-of-range stem gain", async () => {
      const created = await projectService.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Gain Guard",
      });

      for (const gainDb of [Number.NaN, Number.POSITIVE_INFINITY, -24.1, 6.1]) {
        await expect(
          projectService.updateProject(CREATOR_ID, created.id, {
            stems: [{ stemId: LICENSED_STEM_ID, gainDb }],
          }),
        ).rejects.toBeInstanceOf(BadRequestException);
      }
    });

    it("updates the remix mode and rejects unknown modes", async () => {
      const created = await projectService.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Mode Switcher",
      });
      const updated = await projectService.updateProject(CREATOR_ID, created.id, {
        mode: "variation",
      });
      expect(updated.mode).toBe("variation");
      await expect(
        projectService.updateProject(CREATOR_ID, created.id, {
          mode: "voice_clone",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("rejects updates touching stems outside the project", async () => {
      const created = await projectService.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Single Stem",
      });
      await expect(
        projectService.updateProject(CREATOR_ID, created.id, {
          stems: [{ stemId: UNLICENSED_STEM_ID, muted: true }],
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it("enforces ownership on reads and updates", async () => {
      const created = await projectService.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Private Draft",
      });
      await expect(
        projectService.getProject(OTHER_USER_ID, created.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        projectService.updateProject(OTHER_USER_ID, created.id, {
          title: "Hijacked",
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      await expect(
        projectService.getProject(CREATOR_ID, `${TEST_PREFIX}missing_project`),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it("streams generated draft audio for the project owner only", async () => {
      const created = await projectService.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Playable Draft",
      });

      await expect(
        projectService.getDraftAudio(CREATOR_ID, created.id),
      ).rejects.toBeInstanceOf(NotFoundException);

      await prisma.remixProject.update({
        where: { id: created.id },
        data: {
          generationMetadata: {
            output: {
              outputUri: "/storage/remix-drafts/playable.mp3",
              synthIdPresent: true,
              seed: 42,
              sampleRate: 48000,
            },
          },
        },
      });

      storageProvider.download.mockResolvedValueOnce(Buffer.from("private audio"));
      const audio = await projectService.getDraftAudio(CREATOR_ID, created.id);

      expect(audio).toEqual({
        data: Buffer.from("private audio"),
        mimeType: "audio/mpeg",
      });
      expect(storageProvider.download).toHaveBeenCalledWith(
        "/storage/remix-drafts/playable.mp3",
      );
      await expect(
        projectService.getDraftAudio(OTHER_USER_ID, created.id),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it("keeps existing drafts editable but denies generation after artist disables remix consent", async () => {
      const created = await projectService.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Consent Sensitive Draft",
      });

      const edited = await projectService.updateProject(CREATOR_ID, created.id, {
        title: "Consent Sensitive Draft v2",
      });
      expect(edited.title).toBe("Consent Sensitive Draft v2");

      await prisma.artist.update({
        where: { id: ARTIST_ID },
        data: { remixConsent: "disabled" },
      });
      try {
        await expect(
          projectService.generateDraft(CREATOR_ID, created.id, { force: true }),
        ).rejects.toMatchObject({
          response: expect.objectContaining({
            eligibility: expect.objectContaining({
              allowed: false,
              reasons: expect.arrayContaining([
                expect.objectContaining({ code: "artist_remix_disabled" }),
              ]),
            }),
          }),
        });
      } finally {
        await prisma.artist.update({
          where: { id: ARTIST_ID },
          data: { remixConsent: "allowed" },
        });
      }
    });

    it("lists only the caller's projects", async () => {
      const projects = await projectService.listProjects(CREATOR_ID);
      expect(projects.length).toBeGreaterThan(0);
      expect(projects.every((p) => p.creatorUserId === CREATOR_ID)).toBe(true);
      const otherProjects = await projectService.listProjects(OTHER_USER_ID);
      expect(otherProjects).toEqual([]);
    });

    it("rejects creation with an explainable license_required policy response", async () => {
      await expect(
        projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [UNLICENSED_STEM_ID],
          title: "Should Fail",
        }),
      ).rejects.toMatchObject({
        response: expect.objectContaining({
          eligibility: expect.objectContaining({
            allowed: false,
            requiredLicense: "remix",
          }),
        }),
      });
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "remix.license_required",
          creatorId: CREATOR_ID,
          requiredLicense: "remix",
        }),
      );
      const count = await prisma.remixProject.count({
        where: { creatorUserId: CREATOR_ID, title: "Should Fail" },
      });
      expect(count).toBe(0);
    });

    it("rejects creation for blocked sources and emits remix.policy_rejected", async () => {
      await expect(
        projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: BLOCKED_TRACK_ID,
          stemIds: [BLOCKED_STEM_ID],
          title: "Blocked Source",
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(publishSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          eventName: "remix.policy_rejected",
          sourceTrackId: BLOCKED_TRACK_ID,
          reasonCodes: expect.arrayContaining(["source_blocked"]),
        }),
      );
    });

    describe("generateDraft", () => {
      const originalEnv = process.env.REMIX_GENERATION_ENABLED;
      const originalProviderKind = process.env.REMIX_GENERATION_PROVIDER_KIND;

      afterEach(() => {
        if (originalEnv === undefined) {
          delete process.env.REMIX_GENERATION_ENABLED;
        } else {
          process.env.REMIX_GENERATION_ENABLED = originalEnv;
        }
        if (originalProviderKind === undefined) {
          delete process.env.REMIX_GENERATION_PROVIDER_KIND;
        } else {
          process.env.REMIX_GENERATION_PROVIDER_KIND = originalProviderKind;
        }
      });

      it("enqueues pending generation, then records completed provider provenance", async () => {
        process.env.REMIX_GENERATION_ENABLED = "true";
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Generate Me",
          mode: "variation",
          prompt: "darker, halftime",
        });
        const generated = await projectService.generateDraft(
          CREATOR_ID,
          created.id,
          { constraints: { durationSeconds: 60 } },
        );
        expect(generated.generationProvider).toBe("remix-queue");
        expect(generated.generationJobId).toMatch(new RegExp(`^rmxgen_${created.id}_`));
        expect(generated.generationMetadata).toEqual(
          expect.objectContaining({
            status: "pending",
            mode: "variation",
            estimatedCostUsd: null,
            voiceLikenessAllowed: false,
            policyVersion: expect.any(String),
            // Feature conditioning (#1182 slice 3): the licensed stem's
            // measured features ground the prompt.
            grounding: "feature_conditioned",
            sourceFeatureHints: { bpm: 93, key: "G minor" },
          }),
        );
        expect(generationQueue.add).toHaveBeenCalledWith(
          "generate-remix-draft",
          expect.objectContaining({
            jobId: generated.generationJobId,
            projectId: created.id,
            generationInput: expect.objectContaining({
              mode: "variation",
              constraints: { durationSeconds: 60 },
              sourceFeatureHints: { bpm: 93, key: "G minor" },
            }),
          }),
          expect.objectContaining({ attempts: 1, jobId: generated.generationJobId }),
        );
        expect(publishSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_started",
            remixProjectId: created.id,
            provider: "remix-queue",
            generationJobId: generated.generationJobId,
            mode: "variation",
            grounding: "feature_conditioned",
            aiGenerated: true,
          }),
        );

        const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as any;
        await projectService.processGenerationJob(queuedData);
        const completed = await projectService.getProject(CREATOR_ID, created.id);
        expect(completed.generationProvider).toBe("remix-stub");
        expect(completed.generationJobId).toBe(generated.generationJobId);
        expect(completed.generationMetadata).toEqual(
          expect.objectContaining({
            status: "completed",
            estimatedCostUsd: 0.12,
            providerJobId: `rmxgen_${created.id}`,
            completedAt: expect.any(String),
          }),
        );
        expect(publishSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_completed",
            remixProjectId: created.id,
            provider: "remix-stub",
            generationJobId: generated.generationJobId,
            grounding: "feature_conditioned",
            aiGenerated: true,
          }),
        );
      });

      it("records audio_conditioned grounding for prompted audio-conditioned provider jobs", async () => {
        process.env.REMIX_GENERATION_ENABLED = "true";
        process.env.REMIX_GENERATION_PROVIDER_KIND = "audio-conditioned";
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Audio Conditioned",
          mode: "variation",
          prompt: "add a heavy kick while keeping the song recognizable",
        });

        const pending = await projectService.generateDraft(CREATOR_ID, created.id);

        expect(pending.generationMetadata).toEqual(
          expect.objectContaining({
            status: "pending",
            grounding: "audio_conditioned",
            aiGenerated: true,
          }),
        );
        expect(publishSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_started",
            remixProjectId: created.id,
            grounding: "audio_conditioned",
            aiGenerated: true,
          }),
        );

        const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as any;
        await projectService.processGenerationJob(queuedData);

        const completed = await projectService.getProject(CREATOR_ID, created.id);
        expect(completed.generationMetadata).toEqual(
          expect.objectContaining({
            status: "completed",
            grounding: "audio_conditioned",
            aiGenerated: true,
          }),
        );
        expect(publishSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_completed",
            remixProjectId: created.id,
            grounding: "audio_conditioned",
            aiGenerated: true,
          }),
        );
      });

      it("renders Lyria prompted output as one AI layer over the arranged stems (#1209)", async () => {
        process.env.REMIX_GENERATION_ENABLED = "true";
        process.env.REMIX_GENERATION_PROVIDER_KIND = "lyria";
        const layerProvider = {
          createRemixDraft: jest.fn().mockResolvedValue({
            provider: "lyria-3-pro-preview",
            jobId: "layer-job",
            estimatedCostUsd: 0.12,
            outputMetadata: {
              outputUri: "local://generated-layer.wav",
              mimeType: "audio/wav",
              synthIdPresent: true,
              seed: 909,
              sampleRate: 48000,
            },
          }),
        };
        layeredRenderer.render.mockResolvedValue({
          provider: "stem-plus-ai-layered-render",
          jobId: "layered-job",
          estimatedCostUsd: 0.12,
          sourceArrangement: [
            { stemId: LICENSED_STEM_ID, gainDb: null, muted: false },
          ],
          generatedLayers: [
            {
              kind: "generated_layer",
              provider: "lyria-3-pro-preview",
              jobId: "layer-job",
              prompt: "add piano",
              constraints: { durationSeconds: 60 },
              output: {
                outputUri: "local://generated-layer.wav",
                mimeType: "audio/wav",
                synthIdPresent: true,
                seed: 909,
                sampleRate: 48000,
              },
            },
          ],
          renderMetadata: {
            ...REMIX_RENDER_AUDIO_POLICY,
            inputCount: 2,
            activeStemCount: 1,
          },
          outputMetadata: {
            outputUri: "local://stem-plus-ai.mp3",
            mimeType: "audio/mpeg",
            synthIdPresent: true,
            seed: 909,
            sampleRate: 48000,
          },
        });
        const svc = new RemixProjectService(
          eventBus,
          eligibilityService,
          layerProvider as any,
          stemMixRenderer,
          storageProvider,
          generationQueue as any,
          layeredRenderer as any,
        );
        const created = await svc.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Layered",
          mode: "variation",
          prompt: "add piano",
        });

        const pending = await svc.generateDraft(CREATOR_ID, created.id, {
          constraints: { durationSeconds: 60 },
        });

        expect(pending.generationMetadata).toEqual(
          expect.objectContaining({
            status: "pending",
            grounding: "stem_plus_ai",
            aiGenerated: true,
          }),
        );
        const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as any;
        await svc.processGenerationJob(queuedData);

        expect(layerProvider.createRemixDraft).toHaveBeenCalledWith(
          expect.objectContaining({
            prompt: "add piano",
            sourceFeatureHints: { bpm: 93, key: "G minor" },
            stemArrangement: [
              { stemId: LICENSED_STEM_ID, gainDb: null, muted: false },
            ],
          }),
          // Worker-time render grant (#1214) is forwarded as the 2nd arg.
          expect.objectContaining({
            remixProjectId: created.id,
            authorizedStemIds: expect.any(Set),
          }),
        );
        expect(layeredRenderer.render).toHaveBeenCalledWith(
          expect.objectContaining({
            remixProjectId: created.id,
            stems: [{ stemId: LICENSED_STEM_ID, gainDb: null, muted: false }],
            layer: expect.objectContaining({
              provider: "lyria-3-pro-preview",
              jobId: "layer-job",
              prompt: "add piano",
            }),
          }),
        );
        const completed = await svc.getProject(CREATOR_ID, created.id);
        expect(completed.generationProvider).toBe(
          "stem-plus-ai-layered-render",
        );
        expect(completed.generationMetadata).toEqual(
          expect.objectContaining({
            status: "completed",
            grounding: "stem_plus_ai",
            aiGenerated: true,
            providerJobId: "layered-job",
            output: expect.objectContaining({
              outputUri: "local://stem-plus-ai.mp3",
            }),
            generatedLayers: [
              expect.objectContaining({
                kind: "generated_layer",
                provider: "lyria-3-pro-preview",
                output: expect.objectContaining({
                  outputUri: "local://generated-layer.wav",
                }),
              }),
            ],
            renderMetadata: expect.objectContaining({
              schemaVersion: "remix-render-policy/v1",
              inputCount: 2,
              activeStemCount: 1,
              targetLufs: -14,
              truePeakDbtp: -1.5,
            }),
          }),
        );
        expect(publishSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_completed",
            remixProjectId: created.id,
            provider: "stem-plus-ai-layered-render",
            grounding: "stem_plus_ai",
            aiGenerated: true,
          }),
        );
      });

      it("renders stem_mix projects through the renderer, not the AI provider (#1189)", async () => {
        // The render path is deliberately outside the AI master gate.
        delete process.env.REMIX_GENERATION_ENABLED;
        const createSpy = jest.spyOn(
          StubRemixGenerationProvider.prototype,
          "createRemixDraft",
        );
        stemMixRenderer.render.mockClear();
        try {
          const created = await projectService.createProject({
            userId: CREATOR_ID,
            sourceTrackId: TRACK_ID,
            stemIds: [LICENSED_STEM_ID],
            title: "Mix Render",
            mode: "stem_mix",
          });
          const pending = await projectService.generateDraft(
            CREATOR_ID,
            created.id,
          );
          expect(pending.generationMetadata).toEqual(
            expect.objectContaining({
              status: "pending",
              mode: "stem_mix",
              // Rendered drafts ARE the source audio (#1182 slice 3).
              grounding: "stem_audio",
            }),
          );

          const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as any;
          await projectService.processGenerationJob(queuedData);

          const completed = await projectService.getProject(
            CREATOR_ID,
            created.id,
          );
          expect(completed.generationProvider).toBe("stem-mix-render");
          expect(completed.generationMetadata).toEqual(
            expect.objectContaining({
              status: "completed",
              estimatedCostUsd: 0,
              sourceArrangement: [
                expect.objectContaining({
                  stemId: LICENSED_STEM_ID,
                  muted: false,
                }),
              ],
              renderMetadata: expect.objectContaining({
                schemaVersion: "remix-render-policy/v1",
                inputCount: 1,
                activeStemCount: 1,
              }),
            }),
          );
          expect(stemMixRenderer.render).toHaveBeenCalledWith(
            expect.objectContaining({
              remixProjectId: created.id,
              stems: [
                expect.objectContaining({
                  stemId: LICENSED_STEM_ID,
                  muted: false,
                }),
              ],
            }),
          );
          expect(createSpy).not.toHaveBeenCalled();
        } finally {
          createSpy.mockRestore();
        }
      });

      it("records normalized provider_disabled failures from the worker", async () => {
        delete process.env.REMIX_GENERATION_ENABLED;
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Disabled Env",
          // stem_mix routes to the renderer since #1189; the master-gate
          // contract under test belongs to the AI provider path.
          mode: "variation",
          prompt: "darker",
        });
        const pending = await projectService.generateDraft(CREATOR_ID, created.id);
        const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as any;
        await expect(
          projectService.processGenerationJob(queuedData),
        ).rejects.toMatchObject({ code: "provider_disabled", retryable: false });
        expect(publishSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_failed",
            remixProjectId: created.id,
            generationJobId: pending.generationJobId,
            errorCode: "provider_disabled",
            grounding: "feature_conditioned",
            aiGenerated: true,
          }),
        );
        const read = await projectService.getProject(CREATOR_ID, created.id);
        expect(read.generationJobId).toBe(pending.generationJobId);
        expect(read.generationMetadata).toEqual(
          expect.objectContaining({
            status: "failed",
            errorCode: "provider_disabled",
            retryable: false,
          }),
        );
      });

      it("requires a prompt for prompted modes", async () => {
        process.env.REMIX_GENERATION_ENABLED = "true";
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "No Prompt",
          mode: "extension",
        });
        await expect(
          projectService.generateDraft(CREATOR_ID, created.id),
        ).rejects.toBeInstanceOf(BadRequestException);
      });

      it("rejects duplicate active generation jobs and allows explicit retry after completion", async () => {
        process.env.REMIX_GENERATION_ENABLED = "true";
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Double Generate",
        });
        const first = await projectService.generateDraft(CREATOR_ID, created.id);
        await expect(
          projectService.generateDraft(CREATOR_ID, created.id),
        ).rejects.toBeInstanceOf(BadRequestException);
        await expect(
          projectService.generateDraft(CREATOR_ID, created.id, { retry: true }),
        ).rejects.toBeInstanceOf(HttpException);

        const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as any;
        await projectService.processGenerationJob(queuedData);
        const retried = await projectService.generateDraft(CREATOR_ID, created.id, {
          retry: true,
        });
        expect(retried.generationJobId).not.toBe(first.generationJobId);
        expect(retried.generationMetadata).toEqual(
          expect.objectContaining({
            status: "pending",
            retryOfJobId: first.generationJobId,
          }),
        );
      });

      it("reclaims stale pending jobs on retry and drops superseded worker results", async () => {
        process.env.REMIX_GENERATION_ENABLED = "true";
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Stale Reclaim",
        });
        const first = await projectService.generateDraft(CREATOR_ID, created.id);
        const staleJobData = generationQueue.add.mock.calls.at(-1)?.[1] as any;

        // Fresh pending job: retry still conflicts.
        await expect(
          projectService.generateDraft(CREATOR_ID, created.id, { retry: true }),
        ).rejects.toBeInstanceOf(HttpException);

        // Simulate a worker that died (deploy/OOM): the job never reaches a
        // terminal state. Backdate the claim beyond the stale window.
        const staleIso = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        await prisma.$executeRaw`
          UPDATE "RemixProject"
          SET "generationMetadata" =
            jsonb_set("generationMetadata", '{requestedAt}', to_jsonb(${staleIso}::text))
          WHERE "id" = ${created.id}
        `;

        const retried = await projectService.generateDraft(CREATOR_ID, created.id, {
          retry: true,
        });
        expect(retried.generationJobId).not.toBe(first.generationJobId);
        expect(retried.generationMetadata).toEqual(
          expect.objectContaining({
            status: "pending",
            retryOfJobId: first.generationJobId,
          }),
        );

        // If the original worker run resurfaces, it must not touch the
        // replacement job's metadata or publish completion events.
        const staleResult = await projectService.processGenerationJob(staleJobData);
        expect(staleResult).toEqual(
          expect.objectContaining({ skipped: true, reason: "stale_job" }),
        );
        const after = await projectService.getProject(CREATOR_ID, created.id);
        expect(after.generationJobId).toBe(retried.generationJobId);
        expect(after.generationMetadata).toEqual(
          expect.objectContaining({ status: "pending" }),
        );
        expect(publishSpy).not.toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_completed",
            generationJobId: first.generationJobId,
          }),
        );
      });

      it("normalizes unexpected provider failures to provider_unavailable", async () => {
        const explodingProvider = {
          createRemixDraft: jest
            .fn()
            .mockRejectedValue(new Error("vendor boom")),
        };
        const svc = new RemixProjectService(
          eventBus,
          eligibilityService,
          explodingProvider,
          stemMixRenderer,
          storageProvider,
          generationQueue as any,
        );
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Exploding Provider",
          mode: "variation",
          prompt: "darker",
        });
        const pending = await svc.generateDraft(CREATOR_ID, created.id);
        const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as any;
        await expect(svc.processGenerationJob(queuedData)).rejects.toMatchObject({
          code: "provider_unavailable",
          retryable: true,
        });
        expect(publishSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_failed",
            remixProjectId: created.id,
            generationJobId: pending.generationJobId,
            errorCode: "provider_unavailable",
            grounding: "feature_conditioned",
            aiGenerated: true,
          }),
        );
      });

      it("re-checks eligibility and enforces ownership", async () => {
        process.env.REMIX_GENERATION_ENABLED = "true";
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Rights Change",
        });
        await expect(
          projectService.generateDraft(OTHER_USER_ID, created.id),
        ).rejects.toBeInstanceOf(ForbiddenException);

        // Source becomes quarantined after creation: generation must re-deny.
        await prisma.track.update({
          where: { id: TRACK_ID },
          data: { contentStatus: "quarantined" },
        });
        try {
          await expect(
            projectService.generateDraft(CREATOR_ID, created.id),
          ).rejects.toMatchObject({
            response: expect.objectContaining({
              eligibility: expect.objectContaining({ allowed: false }),
            }),
          });
          expect(publishSpy).toHaveBeenCalledWith(
            expect.objectContaining({
              eventName: "remix.policy_rejected",
              sourceTrackId: TRACK_ID,
            }),
          );
        } finally {
          await prisma.track.update({
            where: { id: TRACK_ID },
            data: { contentStatus: "clean" },
          });
        }
      });

      it("re-checks eligibility in the worker and never renders when rights changed after enqueue (#1214)", async () => {
        process.env.REMIX_GENERATION_ENABLED = "true";
        stemMixRenderer.render.mockClear();
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Quarantined Before Render",
          mode: "stem_mix",
        });
        const pending = await projectService.generateDraft(CREATOR_ID, created.id);
        const queuedData = generationQueue.add.mock.calls.at(-1)?.[1] as any;

        // Source is quarantined AFTER the job was queued but BEFORE it runs.
        await prisma.track.update({
          where: { id: TRACK_ID },
          data: { contentStatus: "quarantined" },
        });
        try {
          await expect(
            projectService.processGenerationJob(queuedData),
          ).rejects.toMatchObject({ code: "invalid_input", retryable: false });
          // The render path (and therefore the decrypt boundary) is never reached.
          expect(stemMixRenderer.render).not.toHaveBeenCalled();
          const failed = await projectService.getProject(CREATOR_ID, created.id);
          expect(failed.generationJobId).toBe(pending.generationJobId);
          expect(failed.generationMetadata).toEqual(
            expect.objectContaining({ status: "failed", retryable: false }),
          );
        } finally {
          await prisma.track.update({
            where: { id: TRACK_ID },
            data: { contentStatus: "clean" },
          });
        }
      });
    });

    it("validates mode and required fields", async () => {
      await expect(
        projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Bad Mode",
          mode: "voice_clone",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [],
          title: "No Stems",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "   ",
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe("rate limits (#1144)", () => {
    const limitedService = (env: Record<string, string>) => {
      const previous: Record<string, string | undefined> = {};
      for (const [key, value] of Object.entries(env)) {
        previous[key] = process.env[key];
        process.env[key] = value;
      }
      // Limits are read at construction, so a fresh instance picks them up.
      const service = new RemixProjectService(
        new EventBus(),
        new RemixEligibilityService(),
        new StubRemixGenerationProvider(),
        stemMixRenderer,
        storageProvider,
        generationQueue as any,
      );
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      return service;
    };

    const expect429 = async (promise: Promise<unknown>) => {
      await expect(promise).rejects.toMatchObject({
        status: 429,
        message: expect.stringContaining("Rate limit exceeded"),
      });
      await promise.catch((error) => {
        expect(error).toBeInstanceOf(HttpException);
      });
    };

    it("throttles project creation per user with an actionable 429", async () => {
      const service = limitedService({ REMIX_PROJECT_RATE_LIMIT: "2" });

      const first = await service.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Rate Limit One",
      });
      const second = await service.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Rate Limit Two",
      });
      expect(first.id).toBeDefined();
      expect(second.id).toBeDefined();

      await expect429(
        service.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Rate Limit Three",
        }),
      );

      // The window is per user: another user is not throttled. Denied
      // attempts (no remix license) still consume the caller's budget —
      // throttling counts requests, not successes.
      await expect(
        service.createProject({
          userId: `${TEST_PREFIX}other-user`,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Other User Draft",
        }),
      ).rejects.toMatchObject({ status: 403 });
    });

    it("throttles generation requests before any project work", async () => {
      const service = limitedService({ REMIX_GENERATION_RATE_LIMIT: "1" });
      const project = await service.createProject({
        userId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
        title: "Generation Rate Limit",
      });

      // First call consumes the budget and queues work; provider failures now
      // happen in the worker rather than on the request path.
      await expect(service.generateDraft(CREATOR_ID, project.id)).resolves.toEqual(
        expect.objectContaining({
          generationMetadata: expect.objectContaining({ status: "pending" }),
        }),
      );

      // Second call is throttled before touching the project at all:
      // even a nonexistent project id returns 429, not 404.
      await expect429(service.generateDraft(CREATOR_ID, "missing-project"));
    });
  });
});
