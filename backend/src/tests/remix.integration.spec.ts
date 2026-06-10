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
import { StubRemixGenerationProvider } from "../modules/remix/remix-generation.provider";

const TEST_PREFIX = `remix_${Date.now()}_`;

const CREATOR_ID = `${TEST_PREFIX}creator`;
const OTHER_USER_ID = `${TEST_PREFIX}other`;
const CREATOR_WALLET = `0x${"a1".repeat(20)}`;
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
    await prisma.wallet.create({
      data: { userId: CREATOR_ID, address: CREATOR_WALLET, chainId: 31337 },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: CREATOR_ID,
        displayName: "Remix Test Artist",
        payoutAddress: `0x${"b2".repeat(20)}`,
      },
    });
    const release = await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        artistId: `${TEST_PREFIX}artist`,
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
        { id: LICENSED_STEM_ID, trackId: TRACK_ID, type: "vocals", uri: "local://licensed" },
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
      where: { creatorUserId: { in: [CREATOR_ID, OTHER_USER_ID] } },
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
      where: { id: { in: [CREATOR_ID, OTHER_USER_ID] } },
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
    );
  });

  describe("eligibility", () => {
    it("allows private drafts for a licensed stem on a standard route", async () => {
      const result = await eligibilityService.checkEligibility({
        userId: CREATOR_ID,
        trackId: TRACK_ID,
        stemIds: [LICENSED_STEM_ID],
      });
      expect(result.allowed).toBe(true);
      expect(result.allowedActions).toEqual(["private_draft"]);
      expect(result.stems).toEqual([
        { stemId: LICENSED_STEM_ID, remixable: true, licensed: true },
      ]);
      expect(result.source.rightsRoute).toBe("STANDARD_ESCROW");
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

      // Durability: a brand-new service instance reads the same record.
      const freshService = new RemixProjectService(
        new EventBus(),
        new RemixEligibilityService(),
        new StubRemixGenerationProvider(),
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

      afterEach(() => {
        if (originalEnv === undefined) {
          delete process.env.REMIX_GENERATION_ENABLED;
        } else {
          process.env.REMIX_GENERATION_ENABLED = originalEnv;
        }
      });

      it("persists provider provenance and emits remix.generation_started", async () => {
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
        expect(generated.generationProvider).toBe("remix-stub");
        expect(generated.generationJobId).toBe(`rmxgen_${created.id}`);
        expect(generated.generationMetadata).toEqual(
          expect.objectContaining({
            mode: "variation",
            estimatedCostUsd: 0.12,
            voiceLikenessAllowed: false,
            policyVersion: expect.any(String),
          }),
        );
        expect(publishSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_started",
            remixProjectId: created.id,
            provider: "remix-stub",
            mode: "variation",
          }),
        );
      });

      it("returns the normalized provider_disabled error when generation is off", async () => {
        delete process.env.REMIX_GENERATION_ENABLED;
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Disabled Env",
        });
        await expect(
          projectService.generateDraft(CREATOR_ID, created.id),
        ).rejects.toMatchObject({ code: "provider_disabled", retryable: false });
        expect(publishSpy).toHaveBeenCalledWith(
          expect.objectContaining({
            eventName: "remix.generation_failed",
            remixProjectId: created.id,
            errorCode: "provider_disabled",
          }),
        );
        // No provenance is persisted on failure.
        const read = await projectService.getProject(CREATOR_ID, created.id);
        expect(read.generationJobId).toBeNull();
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

      it("rejects duplicate generation jobs unless forced", async () => {
        process.env.REMIX_GENERATION_ENABLED = "true";
        const created = await projectService.createProject({
          userId: CREATOR_ID,
          sourceTrackId: TRACK_ID,
          stemIds: [LICENSED_STEM_ID],
          title: "Double Generate",
        });
        await projectService.generateDraft(CREATOR_ID, created.id);
        await expect(
          projectService.generateDraft(CREATOR_ID, created.id),
        ).rejects.toBeInstanceOf(BadRequestException);
        const forced = await projectService.generateDraft(CREATOR_ID, created.id, {
          force: true,
        });
        expect(forced.generationJobId).toBe(`rmxgen_${created.id}`);
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
});
