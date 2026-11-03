/**
 * Mashups backend (#2558, S6f-3a of #1903) — Integration Test (Testcontainers)
 *
 * Against real Postgres: a project gets a second source track B; each source
 * is checked on its own (licence tier, artist consent, content status) and a
 * denial names its source; the remix-mashup/v1 recipe is validated and
 * Pro-gated; A's grid leads; removing B takes its stems and recipe along.
 *
 * Run: npm run test:integration
 */

import {
  BadRequestException,
  ForbiddenException,
} from "@nestjs/common";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import { RemixProjectService } from "../modules/remix/remix-project.service";
import {
  RemixEntitlementsService,
  type RemixEntitlementDecision,
} from "../modules/remix/remix-entitlements";
import { stubGenerationCredits } from "./e2e-helpers";

class DenyingEntitlements extends RemixEntitlementsService {
  async pro(): Promise<RemixEntitlementDecision> {
    return {
      allowed: false,
      reason: "not_subscribed",
      policyVersion: "remix-pro-policy/test-deny",
    };
  }
}

const P = `mashup_${Date.now()}_`;
const CREATOR_ID = `${P}creator`;
const CREATOR_WALLET = `0x${"a7".repeat(20)}`;
const OWNER_A_ID = `${P}owner_a`;
const OWNER_B_ID = `${P}owner_b`;
const ARTIST_A_ID = `${P}artist_a`;
const ARTIST_B_ID = `${P}artist_b`;
const TRACK_A = `${P}track_a`;
const TRACK_B = `${P}track_b`;
const TRACK_C = `${P}track_c`;
const A_VOCALS = `${P}a_vocals`;
const A_DRUMS = `${P}a_drums`;
const B_BASS = `${P}b_bass`;
const B_KEYS = `${P}b_keys`;
const C_VOCALS = `${P}c_vocals`;

const features = (tempoBpm: number) => ({
  schemaVersion: "stem-audio-features/v1",
  tempoBpm,
  tempoConfidence: 0.9,
  firstBeatSec: 0,
  durationSeconds: 64,
});

const VALID_MASHUP = {
  schemaVersion: "remix-mashup/v1",
  secondary: { tempoRatio: 1.2, semitones: -2, offsetBars: 4 },
};

let listingSeq = 0;
async function license(stemId: string, licenseType: "remix" | "commercial") {
  listingSeq += 1;
  const listing = await prisma.stemListing.create({
    data: {
      listingId: BigInt(77000 + listingSeq),
      stemId,
      tokenId: BigInt(78000 + listingSeq),
      chainId: 31337,
      contractAddress: `0x${"c3".repeat(20)}`,
      sellerAddress: `0x${"d4".repeat(20)}`,
      pricePerUnit: "1000000",
      amount: BigInt(10),
      paymentToken: `0x${"0".repeat(40)}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      transactionHash: `${P}list_${listingSeq}`,
      blockNumber: BigInt(500 + listingSeq),
      licenseType,
      status: "active",
      listedAt: new Date(),
    },
  });
  await prisma.stemPurchase.create({
    data: {
      listingId: listing.id,
      buyerAddress: CREATOR_WALLET,
      amount: BigInt(1),
      totalPaid: "1000000",
      royaltyPaid: "0",
      protocolFeePaid: "0",
      sellerReceived: "1000000",
      licenseType,
      transactionHash: `${P}buy_${listingSeq}`,
      blockNumber: BigInt(600 + listingSeq),
      // Past the 14-day withdrawal period (#1776), so the licence is active.
      purchasedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    },
  });
}

describe("Remix mashups backend (#2558, integration)", () => {
  let eventBus: EventBus;
  const generationQueue = { add: jest.fn().mockResolvedValue({ id: "queued" }) };

  function service(entitlements?: RemixEntitlementsService) {
    return new RemixProjectService(
      eventBus,
      new RemixEligibilityService(),
      {} as never,
      {} as never,
      { upload: jest.fn(), download: jest.fn(), delete: jest.fn() } as never,
      generationQueue as never,
      stubGenerationCredits() as never,
      undefined,
      undefined,
      entitlements,
    );
  }

  async function createProject(projectService = service()) {
    return projectService.createProject({
      userId: CREATOR_ID,
      sourceTrackId: TRACK_A,
      stemIds: [A_VOCALS, A_DRUMS],
      title: `Mashup ${Math.random()}`,
      mode: "stem_mix",
    });
  }

  beforeAll(async () => {
    eventBus = new EventBus();
    await prisma.user.createMany({
      data: [CREATOR_ID, OWNER_A_ID, OWNER_B_ID].map((id) => ({
        id,
        email: `${id}@test.resonate`,
      })),
    });
    await prisma.wallet.create({
      data: { userId: CREATOR_ID, address: CREATOR_WALLET, chainId: 31337 },
    });
    await prisma.artist.createMany({
      data: [
        { id: ARTIST_A_ID, userId: OWNER_A_ID, displayName: "Artist A", payoutAddress: `0x${"e1".repeat(20)}` },
        { id: ARTIST_B_ID, userId: OWNER_B_ID, displayName: "Artist B", payoutAddress: `0x${"e2".repeat(20)}` },
      ],
    });
    for (const [releaseId, artistId, trackId, title] of [
      [`${P}release_a`, ARTIST_A_ID, TRACK_A, "Night Drive"],
      [`${P}release_b`, ARTIST_B_ID, TRACK_B, "Low Tide"],
      [`${P}release_c`, ARTIST_B_ID, TRACK_C, "Elsewhere"],
    ]) {
      await prisma.release.create({
        data: { id: releaseId, artistId, title, status: "ready", rightsRoute: "STANDARD_ESCROW" },
      });
      await prisma.track.create({
        data: { id: trackId, releaseId, title, position: 1, contentStatus: "clean", rightsRoute: "STANDARD_ESCROW" },
      });
    }
    await prisma.stem.createMany({
      data: [
        { id: A_VOCALS, trackId: TRACK_A, type: "vocals", uri: "local://av", audioFeatures: features(120) },
        { id: A_DRUMS, trackId: TRACK_A, type: "drums", uri: "local://ad", audioFeatures: features(120) },
        { id: B_BASS, trackId: TRACK_B, type: "bass", uri: "local://bb", audioFeatures: features(100) },
        { id: B_KEYS, trackId: TRACK_B, type: "piano", uri: "local://bk", audioFeatures: features(100) },
        { id: C_VOCALS, trackId: TRACK_C, type: "vocals", uri: "local://cv", audioFeatures: features(90) },
      ],
    });
    // Commercial on A (export allowed), only the Remix tier on B's bass
    // (draft and publish, no export); B's keys and C are unlicensed.
    await license(A_VOCALS, "commercial");
    await license(A_DRUMS, "commercial");
    await license(B_BASS, "remix");
    await license(C_VOCALS, "remix");
  });

  afterAll(async () => {
    const tracks = [TRACK_A, TRACK_B, TRACK_C];
    await prisma.remixProjectStem.deleteMany({ where: { project: { sourceTrackId: TRACK_A } } });
    await prisma.remixProject.deleteMany({ where: { sourceTrackId: TRACK_A } });
    await prisma.stemPurchase.deleteMany({ where: { buyerAddress: CREATOR_WALLET } });
    await prisma.stemListing.deleteMany({ where: { stem: { trackId: { in: tracks } } } });
    await prisma.stem.deleteMany({ where: { trackId: { in: tracks } } });
    await prisma.track.deleteMany({ where: { id: { in: tracks } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: P } } });
    await prisma.artist.deleteMany({ where: { id: { in: [ARTIST_A_ID, ARTIST_B_ID] } } });
    await prisma.wallet.deleteMany({ where: { userId: CREATOR_ID } });
    await prisma.user.deleteMany({ where: { id: { in: [CREATOR_ID, OWNER_A_ID, OWNER_B_ID] } } });
    eventBus.destroy();
  });

  beforeEach(() => generationQueue.add.mockClear());

  it("adds a second track with its stems; A's grid leads; B's stems are tagged and offered", async () => {
    const projectService = service();
    const project = await createProject(projectService);
    const before = (await projectService.getProject(CREATOR_ID, project.id)).sectionGrid;

    const updated = await projectService.updateProject(CREATOR_ID, project.id, {
      secondarySourceTrackId: TRACK_B,
      addStemIds: [B_BASS],
    });
    expect(updated.secondarySource).toMatchObject({
      trackId: TRACK_B,
      trackTitle: "Low Tide",
      artistName: null,
    });
    expect(
      Object.fromEntries(updated.stems.map((stem) => [stem.stemId, stem.sourceTrackId])),
    ).toEqual({ [A_VOCALS]: TRACK_A, [A_DRUMS]: TRACK_A, [B_BASS]: TRACK_B });
    // B's 100 BPM never moves A's 120 BPM grid.
    expect(updated.sectionGrid).toEqual(before);

    const view = await projectService.getProject(CREATOR_ID, project.id);
    const available = "availableStems" in view ? view.availableStems : [];
    const keys = available.find((stem) => stem.stemId === B_KEYS);
    expect(keys).toMatchObject({ sourceTrackId: TRACK_B, licensed: false, addable: false });
  });

  it("checks each stem against its own source and names the source that blocks", async () => {
    const projectService = service();
    const project = await createProject(projectService);
    await projectService.updateProject(CREATOR_ID, project.id, {
      secondarySourceTrackId: TRACK_B,
    });

    const attempt = projectService.updateProject(CREATOR_ID, project.id, {
      addStemIds: [B_KEYS],
    });
    await expect(attempt).rejects.toThrow(ForbiddenException);
    await attempt.catch((error: ForbiddenException) => {
      const body = error.getResponse() as {
        eligibility: { reasons: Array<{ code: string; sourceTrackId?: string; sourceRole?: string }> };
      };
      expect(body.eligibility.reasons).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ code: "license_required", sourceTrackId: TRACK_B, sourceRole: "secondary" }),
        ]),
      );
    });

    // A stem of a third track belongs to neither source.
    await expect(
      projectService.updateProject(CREATOR_ID, project.id, { addStemIds: [C_VOCALS] }),
    ).rejects.toThrow(BadRequestException);
    // The second track must be another track.
    await expect(
      projectService.updateProject(CREATOR_ID, project.id, { secondarySourceTrackId: TRACK_A }),
    ).rejects.toThrow(BadRequestException);
  });

  it("allows draft and publish but not export when B is held at the Remix tier", async () => {
    const eligibility = await new RemixEligibilityService().checkSourcesEligibility({
      userId: CREATOR_ID,
      sourceTrackId: TRACK_A,
      secondarySourceTrackId: TRACK_B,
      stemIds: [A_VOCALS, A_DRUMS, B_BASS],
    });
    expect(eligibility.allowed).toBe(true);
    expect(eligibility.allowedActions).toEqual(["private_draft", "publish_resonate"]);
    expect(eligibility.sources).toEqual([
      expect.objectContaining({ trackId: TRACK_A, role: "lead", allowedActions: ["private_draft", "publish_resonate", "export"] }),
      expect.objectContaining({ trackId: TRACK_B, role: "secondary", allowedActions: ["private_draft", "publish_resonate"] }),
    ]);
    expect(eligibility.stems.map((stem) => stem.stemId).sort()).toEqual(
      [A_DRUMS, A_VOCALS, B_BASS].sort(),
    );
  });

  it("needs the export right on both sources to sell the master", async () => {
    const projectService = service();
    const single = await createProject(projectService);
    const mashup = await createProject(projectService);
    await projectService.updateProject(CREATOR_ID, mashup.id, {
      secondarySourceTrackId: TRACK_B,
      addStemIds: [B_BASS],
    });
    // Mark both as published (the publish path itself is covered elsewhere).
    for (const [id, releaseId] of [
      [single.id, `${P}release_b`],
      [mashup.id, `${P}release_c`],
    ]) {
      await prisma.remixProject.update({
        where: { id },
        data: { status: "published", publishedReleaseId: releaseId },
      });
    }
    // A alone is held at Commercial: sellable. B only at Remix: not.
    expect((await projectService.getProject(CREATOR_ID, single.id)).commerce).toMatchObject({
      sellable: true,
    });
    expect((await projectService.getProject(CREATOR_ID, mashup.id)).commerce).toMatchObject({
      sellable: false,
      reasonCode: "commercial_license_required",
    });
  });

  it("blocks rendering when B's artist revokes consent or B is quarantined", async () => {
    const projectService = service();
    const project = await createProject(projectService);
    await projectService.updateProject(CREATOR_ID, project.id, {
      secondarySourceTrackId: TRACK_B,
      addStemIds: [B_BASS],
    });

    const expectBlocked = async (code: string) => {
      const attempt = projectService.generateDraft(CREATOR_ID, project.id, {});
      await expect(attempt).rejects.toThrow(ForbiddenException);
      await attempt.catch((error: ForbiddenException) => {
        const body = error.getResponse() as {
          eligibility: { reasons: Array<{ code: string; sourceTrackId?: string }> };
        };
        expect(body.eligibility.reasons).toEqual(
          expect.arrayContaining([expect.objectContaining({ code, sourceTrackId: TRACK_B })]),
        );
      });
      expect(generationQueue.add).not.toHaveBeenCalled();
    };

    await prisma.artist.update({ where: { id: ARTIST_B_ID }, data: { remixConsent: "disabled" } });
    try {
      await expectBlocked("artist_remix_disabled");
    } finally {
      await prisma.artist.update({ where: { id: ARTIST_B_ID }, data: { remixConsent: "allowed" } });
    }

    await prisma.track.update({ where: { id: TRACK_B }, data: { contentStatus: "quarantined" } });
    try {
      await expectBlocked("source_quarantined");
    } finally {
      await prisma.track.update({ where: { id: TRACK_B }, data: { contentStatus: "clean" } });
    }
  });

  it("validates and Pro-gates the mashup recipe; removing B takes its stems and recipe along", async () => {
    const projectService = service();
    const project = await createProject(projectService);

    // A recipe needs a second track.
    await expect(
      projectService.updateProject(CREATOR_ID, project.id, { mashup: VALID_MASHUP }),
    ).rejects.toThrow(BadRequestException);

    // Without Pro, neither B nor a recipe can be set.
    const denied = service(new DenyingEntitlements());
    const attempt = denied.updateProject(CREATOR_ID, project.id, {
      secondarySourceTrackId: TRACK_B,
    });
    await expect(attempt).rejects.toThrow(ForbiddenException);
    await attempt.catch((error: ForbiddenException) => {
      expect(error.getResponse()).toMatchObject({ code: "pro_required", fields: ["mashup"] });
    });

    await projectService.updateProject(CREATOR_ID, project.id, {
      secondarySourceTrackId: TRACK_B,
      addStemIds: [B_BASS],
    });
    // Outside 0.75–1.33 the tracks are too far apart (D5).
    await expect(
      projectService.updateProject(CREATOR_ID, project.id, {
        mashup: { secondary: { ...VALID_MASHUP.secondary, tempoRatio: 1.5 } },
      }),
    ).rejects.toThrow(/too far apart/);
    const withRecipe = await projectService.updateProject(CREATOR_ID, project.id, {
      mashup: VALID_MASHUP,
    });
    expect(withRecipe.mashup).toEqual(VALID_MASHUP);

    // Taking it apart never needs Pro.
    const removed = await denied.updateProject(CREATOR_ID, project.id, {
      secondarySourceTrackId: null,
    });
    expect(removed.secondarySource).toBeNull();
    expect(removed.mashup).toBeNull();
    expect(removed.stems.map((stem) => stem.stemId).sort()).toEqual([A_DRUMS, A_VOCALS].sort());
    const row = await prisma.remixProject.findUniqueOrThrow({ where: { id: project.id } });
    expect(row.secondarySourceTrackId).toBeNull();
    expect(row.mashup).toBeNull();
  });
});
