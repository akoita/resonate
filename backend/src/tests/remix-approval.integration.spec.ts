/**
 * Remix approval — Integration Test (#2682)
 *
 * An artist who asks to approve AI-assisted remixes of their work keeps other
 * creators' remixes to private drafts. This suite covers the approval step
 * against real Postgres: asking for the current draft version, the artist's
 * preview and decision, eligibility granting publish for the approved version
 * only, a new version needing a new approval, and declines keeping the draft
 * private.
 *
 * Run: npm run test:integration
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../db/prisma";
import { RemixApprovalService } from "../modules/remix/remix-approval.service";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import { REMIX_POLICY_VERSION } from "../modules/remix/remix-eligibility.policy";
import {
  PrismaArtistRemixApprovalSource,
  remixApprovalCards,
} from "../modules/analytics/analytics_remix_approvals";

const TEST_PREFIX = `remix_approval_${Date.now()}_`;
const CREATOR_ID = `${TEST_PREFIX}creator`;
const ARTIST_USER_ID = `${TEST_PREFIX}artist_user`;
const STRANGER_ID = `${TEST_PREFIX}stranger`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const OPEN_ARTIST_ID = `${TEST_PREFIX}open_artist`;
const OPEN_ARTIST_USER_ID = `${TEST_PREFIX}open_artist_user`;
const TRACK_ID = `${TEST_PREFIX}track`;
const OPEN_TRACK_ID = `${TEST_PREFIX}open_track`;
const STEM_ID = `${TEST_PREFIX}stem`;
const OPEN_STEM_ID = `${TEST_PREFIX}open_stem`;
const CREATOR_WALLET = `0x${"a7".repeat(20)}`;

const storage = {
  upload: jest.fn(),
  download: jest.fn().mockResolvedValue(Buffer.from("remix version audio")),
  downloadRange: jest.fn(),
  delete: jest.fn(),
};
const notices = { sendTargeted: jest.fn().mockResolvedValue({ recipientCount: 1, created: 1 }) };

function completedMetadata(outputUri = "local://approval-draft.mp3") {
  return {
    status: "completed",
    mode: "stem_mix",
    policyVersion: REMIX_POLICY_VERSION,
    output: { outputUri, mimeType: "audio/mpeg" },
    completedAt: new Date().toISOString(),
  };
}

async function createProject(trackId: string, stemId: string, jobId: string) {
  return prisma.remixProject.create({
    data: {
      creatorUserId: CREATOR_ID,
      sourceTrackId: trackId,
      title: "Night drive remix",
      mode: "stem_mix",
      policyVersion: REMIX_POLICY_VERSION,
      generationJobId: jobId,
      generationMetadata: completedMetadata() as object,
      stems: { create: [{ stemId }] },
    },
  });
}

async function seedSource(input: {
  artistId: string;
  userId: string;
  trackId: string;
  stemId: string;
  approval: "required" | "not_required";
  n: number;
}) {
  await prisma.artist.create({
    data: {
      id: input.artistId,
      userId: input.userId,
      displayName: `Artist ${input.n}`,
      payoutAddress: `0x${String(input.n).repeat(40)}`,
      aiRemixApproval: input.approval,
    },
  });
  await prisma.release.create({
    data: {
      id: `${input.trackId}_release`,
      artistId: input.artistId,
      title: "Source",
      status: "ready",
      rightsRoute: "STANDARD_ESCROW",
    },
  });
  await prisma.track.create({
    data: {
      id: input.trackId,
      releaseId: `${input.trackId}_release`,
      title: `Source track ${input.n}`,
      position: 1,
      contentStatus: "clean",
      rightsRoute: "STANDARD_ESCROW",
    },
  });
  await prisma.stem.create({
    data: { id: input.stemId, trackId: input.trackId, type: "vocals", uri: "local://stem" },
  });
  const listing = await prisma.stemListing.create({
    data: {
      listingId: BigInt(8200 + input.n),
      stemId: input.stemId,
      tokenId: BigInt(9200 + input.n),
      chainId: 31337,
      contractAddress: `0x${"c3".repeat(20)}`,
      sellerAddress: `0x${"e5".repeat(20)}`,
      pricePerUnit: "1000000",
      amount: BigInt(10),
      paymentToken: `0x${"0".repeat(40)}`,
      expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
      transactionHash: `${TEST_PREFIX}list_${input.n}`,
      blockNumber: BigInt(300 + input.n),
      licenseType: "commercial",
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
      licenseType: "commercial",
      transactionHash: `${TEST_PREFIX}buy_${input.n}`,
      blockNumber: BigInt(310 + input.n),
      purchasedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000),
    },
  });
}

describe("Remix approval (integration)", () => {
  const approvals = new RemixApprovalService(storage as any, notices as any);
  const eligibility = new RemixEligibilityService();

  function eligibilityFor(project: { id: string; generationJobId: string | null }, trackId = TRACK_ID, stemId = STEM_ID) {
    return eligibility.checkEligibility({
      userId: CREATOR_ID,
      trackId,
      stemIds: [stemId],
      allowHistoricalStemIds: true,
      approval: { remixProjectId: project.id, versionKey: project.generationJobId },
    });
  }

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [CREATOR_ID, ARTIST_USER_ID, STRANGER_ID, OPEN_ARTIST_USER_ID].map((id) => ({
        id,
        email: `${id}@test.resonate`,
      })),
    });
    await prisma.wallet.create({ data: { userId: CREATOR_ID, address: CREATOR_WALLET, chainId: 31337 } });
    await seedSource({ artistId: ARTIST_ID, userId: ARTIST_USER_ID, trackId: TRACK_ID, stemId: STEM_ID, approval: "required", n: 1 });
    await seedSource({ artistId: OPEN_ARTIST_ID, userId: OPEN_ARTIST_USER_ID, trackId: OPEN_TRACK_ID, stemId: OPEN_STEM_ID, approval: "not_required", n: 2 });
  });

  afterAll(async () => {
    await prisma.remixProject.deleteMany({ where: { creatorUserId: CREATOR_ID } });
    await prisma.stemPurchase.deleteMany({ where: { transactionHash: { startsWith: TEST_PREFIX } } });
    await prisma.stemListing.deleteMany({ where: { transactionHash: { startsWith: TEST_PREFIX } } });
    await prisma.stem.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
    await prisma.wallet.deleteMany({ where: { userId: CREATOR_ID } });
    await prisma.user.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  });

  beforeEach(() => {
    notices.sendTargeted.mockClear();
  });

  it("approves one version: publish and export open for it, and a new version needs a new approval", async () => {
    const project = await createProject(TRACK_ID, STEM_ID, `${TEST_PREFIX}job_1`);

    const before = await eligibilityFor(project);
    expect(before.allowedActions).toEqual(["private_draft"]);
    expect(before.limits?.map((l) => l.code)).toEqual(["artist_approval_required"]);

    const asked = await approvals.requestApproval(CREATOR_ID, project.id, { message: "  Made this for the night drive set.  " });
    expect(asked.requiredArtists.map((a) => a.id)).toEqual([ARTIST_ID]);
    expect(asked.current).toHaveLength(1);
    expect(asked.current[0]).toMatchObject({ status: "pending", message: "Made this for the night drive set." });
    expect(asked.approved).toBe(false);
    expect(notices.sendTargeted).toHaveBeenCalledWith(
      expect.objectContaining({ userIds: [ARTIST_USER_ID], category: "service", link: "/artist/remix-approvals" }),
      { userId: "system:remix" },
      { dedupeKey: `remix_approval_request:${asked.current[0].id}` },
    );

    // Asking again keeps the one pending request.
    const again = await approvals.requestApproval(CREATOR_ID, project.id);
    expect(again.current.map((r) => r.id)).toEqual([asked.current[0].id]);

    const incoming = await approvals.listIncoming(ARTIST_USER_ID, "pending");
    const mine = incoming.find((row) => row.id === asked.current[0].id);
    expect(mine).toMatchObject({ remixTitle: "Night drive remix", versionAvailable: true, creatorName: "A remix creator" });
    expect(await approvals.listIncoming(STRANGER_ID)).toEqual([]);

    const audio = await approvals.previewAudio(ARTIST_USER_ID, asked.current[0].id);
    expect(audio.data.toString()).toBe("remix version audio");
    await expect(approvals.previewAudio(STRANGER_ID, asked.current[0].id)).rejects.toBeInstanceOf(NotFoundException);
    // The creator cannot answer their own request.
    await expect(
      approvals.decide(CREATOR_ID, asked.current[0].id, { decision: "approve" }),
    ).rejects.toBeInstanceOf(NotFoundException);

    const decided = await approvals.decide(ARTIST_USER_ID, asked.current[0].id, { decision: "approve" });
    expect(decided.status).toBe("approved");
    expect(notices.sendTargeted).toHaveBeenLastCalledWith(
      expect.objectContaining({ userIds: [CREATOR_ID], title: "Artist 1 approved your remix" }),
      { userId: "system:remix" },
      { dedupeKey: `remix_approval_decision:${asked.current[0].id}` },
    );
    await expect(
      approvals.decide(ARTIST_USER_ID, asked.current[0].id, { decision: "decline" }),
    ).rejects.toBeInstanceOf(ConflictException);

    const after = await eligibilityFor(project);
    expect(after.allowedActions).toEqual(["private_draft", "publish_resonate", "export"]);
    expect(after.limits).toBeUndefined();
    expect((await approvals.projectState(CREATOR_ID, project.id)).approved).toBe(true);

    // A new draft is a new version: the approval does not carry over.
    const regenerated = await prisma.remixProject.update({
      where: { id: project.id },
      data: { generationJobId: `${TEST_PREFIX}job_2` },
    });
    const newVersion = await eligibilityFor(regenerated);
    expect(newVersion.allowedActions).toEqual(["private_draft"]);
    const state = await approvals.projectState(CREATOR_ID, project.id);
    expect(state).toMatchObject({ currentVersionKey: `${TEST_PREFIX}job_2`, current: [], approved: false });

    // The old version is no longer playable, so it cannot be previewed.
    await expect(approvals.previewAudio(ARTIST_USER_ID, asked.current[0].id)).rejects.toBeInstanceOf(NotFoundException);
  });

  it("a decline keeps the draft private, tells the creator, and the same version cannot be asked again", async () => {
    const project = await createProject(TRACK_ID, STEM_ID, `${TEST_PREFIX}job_decline`);
    const pendingSource = new PrismaArtistRemixApprovalSource();
    const pendingBefore = await pendingSource.countPendingApprovals(ARTIST_ID);
    const asked = await approvals.requestApproval(CREATOR_ID, project.id);
    const requestId = asked.current[0].id;

    // #1121: the artist's analytics shows a next-step card while a version waits.
    const pendingWhileAsked = await pendingSource.countPendingApprovals(ARTIST_ID);
    expect(pendingWhileAsked).toBe(pendingBefore + 1);
    expect(remixApprovalCards(pendingWhileAsked)).toEqual([
      expect.objectContaining({
        type: "review_remix_approvals",
        cta: expect.objectContaining({ href: "/artist/remix-approvals" }),
        sourceSignal: expect.objectContaining({ count: pendingWhileAsked }),
      }),
    ]);
    expect(remixApprovalCards(0)).toEqual([]);

    await expect(
      approvals.decide(ARTIST_USER_ID, requestId, { decision: "maybe" }),
    ).rejects.toBeInstanceOf(BadRequestException);
    const declined = await approvals.decide(ARTIST_USER_ID, requestId, {
      decision: "decline",
      reason: "Too close to the original vocal.",
    });
    expect(declined).toMatchObject({ status: "declined", reason: "Too close to the original vocal." });
    expect(notices.sendTargeted).toHaveBeenLastCalledWith(
      expect.objectContaining({
        userIds: [CREATOR_ID],
        title: "Artist 1 declined your remix",
        body: expect.stringContaining("Too close to the original vocal."),
      }),
      expect.anything(),
      expect.anything(),
    );

    expect(await pendingSource.countPendingApprovals(ARTIST_ID)).toBe(pendingBefore);
    expect((await eligibilityFor(project)).allowedActions).toEqual(["private_draft"]);
    await expect(approvals.requestApproval(CREATOR_ID, project.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "version_declined" }),
    });
  });

  it("refuses requests that make no sense", async () => {
    const open = await createProject(OPEN_TRACK_ID, OPEN_STEM_ID, `${TEST_PREFIX}job_open`);
    await expect(approvals.requestApproval(CREATOR_ID, open.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "approval_not_needed" }),
    });

    const project = await createProject(TRACK_ID, STEM_ID, `${TEST_PREFIX}job_other`);
    await expect(approvals.requestApproval(STRANGER_ID, project.id)).rejects.toBeInstanceOf(ForbiddenException);
    await expect(
      approvals.requestApproval(CREATOR_ID, project.id, { message: "x".repeat(501) }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const unfinished = await prisma.remixProject.create({
      data: {
        creatorUserId: CREATOR_ID,
        sourceTrackId: TRACK_ID,
        title: "Unfinished",
        mode: "stem_mix",
        policyVersion: REMIX_POLICY_VERSION,
        generationJobId: `${TEST_PREFIX}job_pending`,
        generationMetadata: { status: "processing" },
      },
    });
    await expect(approvals.requestApproval(CREATOR_ID, unfinished.id)).rejects.toMatchObject({
      response: expect.objectContaining({ code: "draft_not_completed" }),
    });
  });
});
