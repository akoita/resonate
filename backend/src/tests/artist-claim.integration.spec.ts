/**
 * Artist claim lifecycle against the real Testcontainers Postgres.
 *
 * The partial unique indexes are read from the migration and installed into
 * the schema-pushed test database before the lifecycle cases run.
 */
import { readFileSync } from "fs";
import { resolve } from "path";
import { prisma } from "../db/prisma";
import { AnalyticsGovernanceService } from "../modules/analytics/analytics_governance.service";
import { ArtistService } from "../modules/artist/artist.service";
import { PersonalDataResolverService } from "../modules/identity/personal_data_resolver.service";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { PersonalDataErasureService } from "../modules/privacy/personal_data_erasure.service";
import { EventBus } from "../modules/shared/event_bus";

const TEST_PREFIX = `artist_claim_${Date.now()}_`;
const CLAIMANT_A = `${TEST_PREFIX}claimant_a`;
const CLAIMANT_B = `${TEST_PREFIX}claimant_b`;
const CASE_CLAIMANT = `0x${Date.now().toString(16).padStart(40, "0")}`;
const REVIEWER = `${TEST_PREFIX}reviewer`;
const ADMIN = `${TEST_PREFIX}admin`;
const CAP_CLAIMANT = `${TEST_PREFIX}cap_claimant`;
const SUMMARY_CLAIMANT = `${TEST_PREFIX}summary_claimant`;
const SUMMARY_OTHER = `${TEST_PREFIX}summary_other`;
const CASCADE_CLAIMANT = `${TEST_PREFIX}cascade_claimant`;
const USER_IDS = [
  CLAIMANT_A,
  CLAIMANT_B,
  CASE_CLAIMANT,
  REVIEWER,
  ADMIN,
  CAP_CLAIMANT,
  SUMMARY_CLAIMANT,
  SUMMARY_OTHER,
  CASCADE_CLAIMANT,
];
const rotatedUserIds: string[] = [];

const MIGRATION_SQL = resolve(
  __dirname,
  "../../prisma/migrations/20260923130000_artist_claim_request/migration.sql",
);

let service: ArtistService;
let eventBus: EventBus;

async function createArtist(
  suffix: string,
  displayName: string,
  options: { credit?: boolean; identityStatus?: string; role?: string } = {},
) {
  const artistId = `${TEST_PREFIX}${suffix}`;
  const artist = await prisma.artist.create({
    data: {
      id: artistId,
      displayName,
      profileType: "public_artist",
      claimStatus: "unclaimed",
    },
  });

  if (options.credit !== false) {
    const releaseId = `${TEST_PREFIX}${suffix}_release`;
    await prisma.release.create({
      data: { id: releaseId, artistId, title: `${displayName} release` },
    });
    await prisma.releaseArtistCredit.create({
      data: {
        id: `${TEST_PREFIX}${suffix}_credit`,
        artistId,
        releaseId,
        role: options.role ?? "main",
        displayName,
        identityStatus: options.identityStatus ?? "selected",
      },
    });
  }

  return artist;
}

async function ensurePartialUniqueIndexes() {
  const sql = readFileSync(MIGRATION_SQL, "utf8");
  const statements = sql.match(
    /CREATE UNIQUE INDEX "ArtistClaimRequest_[^"]+"[\s\S]*?;/g,
  );
  if (!statements || statements.length !== 2) {
    throw new Error(`Expected both partial unique indexes in ${MIGRATION_SQL}`);
  }

  for (const statement of statements) {
    const name = statement.match(/CREATE UNIQUE INDEX "([^"]+)"/)?.[1];
    if (!name) throw new Error(`Could not read index name from ${statement}`);
    const [{ exists }] = await prisma.$queryRaw<{ exists: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_class WHERE relname = ${name}
      ) AS "exists"`;
    if (!exists) await prisma.$executeRawUnsafe(statement);
  }
}

beforeAll(async () => {
  eventBus = new EventBus();
  service = new ArtistService(eventBus);
  for (const id of USER_IDS) {
    await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  }
  await ensurePartialUniqueIndexes();
});

afterAll(async () => {
  await prisma.artistClaimRequest.deleteMany({
    where: { artistId: { startsWith: TEST_PREFIX } },
  });
  await prisma.releaseArtistCredit.deleteMany({
    where: { artistId: { startsWith: TEST_PREFIX } },
  });
  await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.artist.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } });
  await prisma.user.deleteMany({
    where: {
      OR: [
        { id: { startsWith: TEST_PREFIX } },
        ...(rotatedUserIds.length ? [{ id: { in: rotatedUserIds } }] : []),
      ],
    },
  });
  eventBus.destroy();
  await prisma.$disconnect();
});

describe("ArtistService claim lifecycle (integration)", () => {
  it("validates evidence and eligibility, and keeps same-name artist IDs distinct", async () => {
    const first = await createArtist("same_name_a", "Same Name Artist");
    const second = await createArtist("same_name_b", "Same Name Artist", { role: "primary" });
    const ambiguous = await createArtist("ambiguous", "Ambiguous Artist", {
      identityStatus: "ambiguous",
    });
    const noCredit = await createArtist("no_credit", "No Credit Artist", { credit: false });

    const claim = await service.submitClaim(
      CLAIMANT_A,
      first.id,
      "  I performed and released this recording.  ",
    );
    expect(claim.status).toBe("pending");
    expect(await service.getMyClaim(CLAIMANT_B, first.id)).toBeNull();
    expect(await service.getMyClaim(CLAIMANT_A, second.id)).toBeNull();
    expect((await prisma.artist.findUnique({ where: { id: second.id } }))?.claimStatus).toBe("unclaimed");
    await expect(service.submitClaim(
      CLAIMANT_A,
      first.id,
      "A second pending claim for the same exact artist.",
    )).rejects.toMatchObject({ status: 409 });

    await expect(service.submitClaim(CLAIMANT_A, first.id, "too short"))
      .rejects.toMatchObject({ status: 400 });
    await expect(service.submitClaim(CLAIMANT_A, ambiguous.id, "Evidence that meets the minimum length."))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.submitClaim(CLAIMANT_A, noCredit.id, "Evidence that meets the minimum length."))
      .rejects.toMatchObject({ status: 409 });
    await expect(service.listPendingClaims("listener"))
      .rejects.toMatchObject({ status: 403 });

    expect(await prisma.artistClaimRequest.count({ where: { artistId: second.id } })).toBe(0);
  });

  it("reports claim eligibility for credited and uncredited search results", async () => {
    const eligible = await createArtist("search_eligible", "Search Eligible Artist", {
      role: "primary",
    });
    const noCredit = await createArtist("search_no_credit", "Search No Credit Artist", {
      credit: false,
    });
    const ambiguous = await createArtist("search_ambiguous", "Search Ambiguous Artist", {
      identityStatus: "ambiguous",
    });

    const results = await service.searchByName("Search");

    expect(results).toHaveLength(3);
    expect(results).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: eligible.id, canRequestClaim: true }),
      expect.objectContaining({ id: noCredit.id, canRequestClaim: false }),
      expect.objectContaining({ id: ambiguous.id, canRequestClaim: false }),
    ]));
  });

  it("returns only each exact artist's latest claim summary for the caller", async () => {
    const first = await createArtist("summary_same_name_a", "Summary Artist");
    const second = await createArtist("summary_same_name_b", "Summary Artist");
    const other = await createArtist("summary_other_user", "Other User Artist");
    await prisma.artist.update({
      where: { id: first.id },
      data: { imageUrl: "https://cdn.test/summary-a.jpg" },
    });

    const older = await service.submitClaim(
      SUMMARY_CLAIMANT,
      first.id,
      "Evidence for the earlier claim that was rejected.",
    );
    await service.reviewClaim(REVIEWER, "operator", older.id, "reject");
    await prisma.artistClaimRequest.update({
      where: { id: older.id },
      data: { createdAt: new Date("2020-01-01T00:00:00.000Z") },
    });

    const latest = await service.submitClaim(
      SUMMARY_CLAIMANT,
      first.id,
      "Evidence for the latest claim on this exact artist.",
    );
    await service.submitClaim(
      SUMMARY_CLAIMANT,
      second.id,
      "Evidence for a same-name but separate artist identity.",
    );
    await service.submitClaim(
      SUMMARY_OTHER,
      other.id,
      "Evidence from another user's independent claim.",
    );

    const summaries = await service.getMyClaims(SUMMARY_CLAIMANT);
    expect(summaries).toHaveLength(2);
    expect(summaries.map((summary) => summary.artist.id).sort()).toEqual([first.id, second.id].sort());

    const firstSummary = summaries.find((summary) => summary.artist.id === first.id)!;
    expect(firstSummary).toMatchObject({
      status: "pending",
      createdAt: latest.createdAt,
      artist: {
        id: first.id,
        displayName: "Summary Artist",
        imageUrl: "https://cdn.test/summary-a.jpg",
      },
    });
    expect(Object.keys(firstSummary).sort()).toEqual(
      ["artist", "createdAt", "reviewedAt", "status", "updatedAt"].sort(),
    );
    expect(firstSummary).not.toHaveProperty("evidence");
    expect(firstSummary).not.toHaveProperty("claimantUserId");
    expect(firstSummary).not.toHaveProperty("reviewerUserId");
    expect(firstSummary).not.toHaveProperty("reviewNote");
    expect(firstSummary).not.toHaveProperty("id");
    expect(firstSummary).not.toHaveProperty("artistId");
  });

  it("cascades decision history when a claim is deleted", async () => {
    const artist = await createArtist("decision_event_cascade", "Decision Event Cascade");
    const claim = await service.submitClaim(
      CASCADE_CLAIMANT,
      artist.id,
      "Evidence for a claim whose audit history will be deleted.",
    );
    await service.reviewClaim(REVIEWER, "operator", claim.id, "reject");
    expect(await prisma.artistClaimDecisionEvent.count({ where: { claimId: claim.id } })).toBe(1);

    await prisma.artistClaimRequest.delete({ where: { id: claim.id } });
    expect(await prisma.artistClaimDecisionEvent.count({ where: { claimId: claim.id } })).toBe(0);
  });

  it("caps concurrent pending submissions at five per claimant and frees a slot after review", async () => {
    const artists = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        createArtist(`cap_${index}`, `Cap Artist ${index}`),
      ),
    );
    const outcomes = await Promise.allSettled(
      artists.map((artist) =>
        service.submitClaim(
          CAP_CLAIMANT,
          artist.id,
          "Evidence for a claimant's concurrent pending submission.",
        ),
      ),
    );

    const succeeded = outcomes.flatMap((outcome, index) =>
      outcome.status === "fulfilled" ? [{ index, claim: outcome.value }] : [],
    );
    const failedIndex = outcomes.findIndex((outcome) => outcome.status === "rejected");
    expect(succeeded).toHaveLength(5);
    expect(failedIndex).toBeGreaterThanOrEqual(0);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);
    await expect(service.submitClaim(
      CAP_CLAIMANT,
      artists[failedIndex].id,
      "Evidence for a submission over the pending limit.",
    )).rejects.toMatchObject({ status: 409 });

    await service.reviewClaim(REVIEWER, "operator", succeeded[0].claim.id, "reject");
    const nextClaim = await service.submitClaim(
      CAP_CLAIMANT,
      artists[failedIndex].id,
      "Evidence after another pending request was rejected.",
    );
    expect(nextClaim.status).toBe("pending");
    expect(await prisma.artistClaimRequest.count({
      where: { claimantUserId: CAP_CLAIMANT, status: "pending" },
    })).toBe(5);
  });

  it("enforces the partial pending and approved uniqueness rules in Postgres", async () => {
    const pendingArtist = await createArtist("unique_pending", "Pending Unique");
    const pendingData = {
      artistId: pendingArtist.id,
      claimantUserId: CLAIMANT_A,
      evidence: "A direct database row for the partial index.",
    };
    await prisma.artistClaimRequest.create({ data: pendingData });
    await expect(prisma.artistClaimRequest.create({ data: pendingData }))
      .rejects.toMatchObject({ code: "P2002" });

    const approvedArtist = await createArtist("unique_approved", "Approved Unique");
    await prisma.artistClaimRequest.create({
      data: {
        artistId: approvedArtist.id,
        claimantUserId: CLAIMANT_A,
        evidence: "An approved database row for the partial index.",
        status: "approved",
      },
    });
    await expect(prisma.artistClaimRequest.create({
      data: {
        artistId: approvedArtist.id,
        claimantUserId: CLAIMANT_B,
        evidence: "A second approved database row for the partial index.",
        status: "approved",
      },
    })).rejects.toMatchObject({ code: "P2002" });
  });

  it("rejects a pending claim and returns a status-only claimant DTO", async () => {
    const artist = await createArtist("reject", "Reject Artist");
    const claim = await service.submitClaim(
      CLAIMANT_A,
      artist.id,
      "Evidence supplied privately for operator review.",
    );

    const rejected = await service.reviewClaim(
      REVIEWER,
      "operator",
      claim.id,
      "reject",
      "This release credit does not substantiate the claim.",
    );
    expect(rejected?.status).toBe("rejected");
    const row = await prisma.artistClaimRequest.findUnique({ where: { id: claim.id } });
    expect(row).toMatchObject({
      claimantUserId: CLAIMANT_A,
      reviewerUserId: REVIEWER,
      reviewNote: "This release credit does not substantiate the claim.",
    });
    expect(row?.reviewedAt).toBeInstanceOf(Date);

    const ownDto = await service.getMyClaim(CLAIMANT_A, artist.id);
    expect(ownDto).toMatchObject({ id: claim.id, status: "rejected" });
    expect(ownDto).not.toHaveProperty("evidence");
    expect(ownDto).not.toHaveProperty("reviewNote");
    expect(ownDto).not.toHaveProperty("claimantUserId");
    const decisionEvent = await prisma.artistClaimDecisionEvent.findFirst({
      where: { claimId: claim.id },
    });
    expect(decisionEvent).toMatchObject({
      claimId: claim.id,
      actorUserId: REVIEWER,
      decision: "reject",
      note: "This release credit does not substantiate the claim.",
    });
    expect(decisionEvent?.createdAt).toBeInstanceOf(Date);
  });

  it("prevents admins and operators from deciding their own claims, ignoring wallet case", async () => {
    const artist = await createArtist("self_review", "Self Review Artist");
    const claim = await service.submitClaim(
      CASE_CLAIMANT,
      artist.id,
      "Evidence for a claim that its claimant must not review.",
    );

    await expect(service.reviewClaim(
      CASE_CLAIMANT.toUpperCase(),
      "operator",
      claim.id,
      "reject",
    )).rejects.toMatchObject({ status: 403 });
    await expect(service.reviewClaim(
      CASE_CLAIMANT,
      "admin",
      claim.id,
      "approve",
    )).rejects.toMatchObject({ status: 403 });
    expect(await prisma.artistClaimRequest.findUnique({ where: { id: claim.id } }))
      .toMatchObject({ status: "pending", reviewerUserId: null });
    expect(await prisma.artistClaimDecisionEvent.count({ where: { claimId: claim.id } })).toBe(0);

    const approved = await service.reviewClaim(REVIEWER, "operator", claim.id, "approve");
    expect(approved?.status).toBe("approved");
    await expect(service.reviewClaim(
      CASE_CLAIMANT.toUpperCase(),
      "admin",
      claim.id,
      "revoke",
    )).rejects.toMatchObject({ status: 403 });
    expect(await prisma.artistClaimRequest.findUnique({ where: { id: claim.id } }))
      .toMatchObject({ status: "approved", reviewerUserId: REVIEWER });
    expect(await prisma.artistClaimDecisionEvent.count({ where: { claimId: claim.id } })).toBe(1);
  });

  it("approves one competing claim, rejects the rest, and limits the claimant to public profile edits", async () => {
    const artist = await createArtist("competing", "Competing Claims");
    const claimA = await service.submitClaim(
      CLAIMANT_A,
      artist.id,
      "Claim evidence from the first claimant.",
    );
    const claimB = await service.submitClaim(
      CLAIMANT_B,
      artist.id,
      "Claim evidence from the second claimant.",
    );

    const outcomes = await Promise.allSettled([
      service.reviewClaim(REVIEWER, "operator", claimA.id, "approve"),
      service.reviewClaim(ADMIN, "admin", claimB.id, "approve"),
    ]);
    expect(outcomes.filter((outcome) => outcome.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter((outcome) => outcome.status === "rejected")).toHaveLength(1);

    const rows = await prisma.artistClaimRequest.findMany({
      where: { artistId: artist.id },
      orderBy: { claimantUserId: "asc" },
    });
    const approved = rows.find((row) => row.status === "approved")!;
    const rejected = rows.find((row) => row.status === "rejected")!;
    const automaticRejection = await prisma.artistClaimDecisionEvent.findFirst({
      where: { claimId: rejected.id },
    });
    expect(automaticRejection).toMatchObject({
      claimId: rejected.id,
      actorUserId: approved.reviewerUserId,
      decision: "reject",
      note: "Another claim for this artist was approved.",
    });
    expect(automaticRejection?.createdAt).toBeInstanceOf(Date);
    expect(rejected).toMatchObject({
      reviewNote: "Another claim for this artist was approved.",
    });
    expect(rejected.reviewedAt).toBeInstanceOf(Date);
    expect([REVIEWER, ADMIN]).toContain(rejected.reviewerUserId);
    const pendingQueue = await service.listPendingClaims("operator");
    expect(pendingQueue.filter((pending) => pending.artistId === artist.id)).toEqual([]);

    const rejectedHistory = await service.getMyClaims(rejected.claimantUserId);
    expect(rejectedHistory).toEqual(expect.arrayContaining([
      expect.objectContaining({
        status: "rejected",
        artist: expect.objectContaining({
          id: artist.id,
          canRequestClaim: false,
        }),
      }),
    ]));

    const updatedArtist = await prisma.artist.findUnique({ where: { id: artist.id } });
    expect(updatedArtist).toMatchObject({ userId: null, claimStatus: "claimed" });
    expect(approved.claimantUserId).not.toBe(updatedArtist?.userId);

    await service.updateProfile(approved.claimantUserId, artist.id, {
      summary: "  Profile updated by the approved claimant.  ",
      payoutAddress: "0xattacker",
      remixConsent: "disabled",
      userId: "replacement-manager",
    } as any);
    const afterEdit = await prisma.artist.findUnique({ where: { id: artist.id } });
    expect(afterEdit).toMatchObject({
      summary: "Profile updated by the approved claimant.",
      payoutAddress: null,
      remixConsent: "allowed",
      userId: null,
      claimStatus: "claimed",
    });

    const otherUser = approved.claimantUserId === CLAIMANT_A ? CLAIMANT_B : CLAIMANT_A;
    await expect(service.updateProfile(otherUser, artist.id, { summary: "Not authorized" }))
      .rejects.toMatchObject({ status: 403 });
    await expect(service.updateSettings(approved.claimantUserId, artist.id, { remixConsent: "disabled" }))
      .rejects.toMatchObject({ status: 404 });
    await expect(service.getSettings(approved.claimantUserId, artist.id))
      .rejects.toMatchObject({ status: 404 });
    expect((await prisma.artist.findUnique({ where: { id: artist.id } }))?.remixConsent).toBe("allowed");
  });

  it("revokes an approved claim and removes the claimant's profile edit grant", async () => {
    const artist = await createArtist("revoke", "Revocable Artist");
    const claim = await service.submitClaim(
      CLAIMANT_A,
      artist.id,
      "Evidence for a claim that will later be revoked.",
    );
    await service.reviewClaim(REVIEWER, "operator", claim.id, "approve");

    const revoked = await service.reviewClaim(
      ADMIN,
      "admin",
      claim.id,
      "revoke",
      "New information invalidated the claim.",
    );
    expect(revoked?.status).toBe("revoked");
    const history = await prisma.artistClaimDecisionEvent.findMany({
      where: { claimId: claim.id },
    });
    expect(history).toHaveLength(2);
    expect(history.find((event) => event.decision === "approve")).toMatchObject({
      claimId: claim.id,
      actorUserId: REVIEWER,
      decision: "approve",
      note: null,
    });
    expect(history.find((event) => event.decision === "revoke")).toMatchObject({
      claimId: claim.id,
      actorUserId: ADMIN,
      decision: "revoke",
      note: "New information invalidated the claim.",
    });
    expect(history.every((event) => event.createdAt instanceof Date)).toBe(true);
    expect((await prisma.artist.findUnique({ where: { id: artist.id } }))?.claimStatus).toBe("unclaimed");
    expect(await service.getMyClaims(CLAIMANT_A)).toContainEqual(expect.objectContaining({
      status: "revoked",
      artist: expect.objectContaining({ id: artist.id }),
    }));
    await expect(service.updateProfile(CLAIMANT_A, artist.id, { summary: "After revocation" }))
      .rejects.toMatchObject({ status: 403 });
  });

  it("scrubs private claim text and revokes an erased claimant's grant", async () => {
    const artist = await createArtist("erasure", "Erasure Artist");
    await prisma.releaseArtistCredit.update({
      where: { id: `${TEST_PREFIX}erasure_credit` },
      data: {
        identityReviewerUserId: CLAIMANT_A,
        identityReviewNote: "Private credit review note that must also be scrubbed.",
      },
    });
    const claim = await service.submitClaim(
      CLAIMANT_A,
      artist.id,
      "Private evidence that must be scrubbed at account erasure.",
    );
    await service.reviewClaim(
      REVIEWER,
      "operator",
      claim.id,
      "approve",
      "Private review note that must also be scrubbed.",
    );

    const erasure = new PersonalDataErasureService(
      new PersonalDataResolverService(),
      new AnalyticsGovernanceService(),
      new AccountClosureService(),
    );
    const result = await erasure.eraseAccount(CLAIMANT_A);
    rotatedUserIds.push(result.newUserId);

    const row = await prisma.artistClaimRequest.findUnique({ where: { id: claim.id } });
    expect(row).toMatchObject({ status: "revoked", evidence: null, reviewNote: null });
    const claimantEvent = await prisma.artistClaimDecisionEvent.findFirst({
      where: { claimId: claim.id },
    });
    expect(claimantEvent).toMatchObject({
      decision: "approve",
      actorUserId: REVIEWER,
      note: null,
    });
    expect((await prisma.artist.findUnique({ where: { id: artist.id } }))?.claimStatus).toBe("unclaimed");
    const credit = await prisma.releaseArtistCredit.findUnique({
      where: { id: `${TEST_PREFIX}erasure_credit` },
    });
    expect(credit).toMatchObject({ identityReviewerUserId: null, identityReviewNote: null });
    expect((await prisma.user.findUnique({ where: { id: result.newUserId } }))?.erasedAt).toBeInstanceOf(Date);

    const reviewerArtist = await createArtist("reviewer_erasure", "Reviewer Erasure Artist");
    const reviewerClaim = await service.submitClaim(
      CLAIMANT_B,
      reviewerArtist.id,
      "Evidence written by a claimant who remains active.",
    );
    await service.reviewClaim(
      REVIEWER,
      "operator",
      reviewerClaim.id,
      "reject",
      "Private review note written by the reviewer being erased.",
    );

    const reviewerErasure = await erasure.eraseAccount(REVIEWER);
    rotatedUserIds.push(reviewerErasure.newUserId);
    const reviewerRow = await prisma.artistClaimRequest.findUnique({ where: { id: reviewerClaim.id } });
    expect(reviewerRow).toMatchObject({
      status: "rejected",
      evidence: "Evidence written by a claimant who remains active.",
      reviewNote: null,
      reviewerUserId: reviewerErasure.newUserId,
    });
    const reviewerEvent = await prisma.artistClaimDecisionEvent.findFirst({
      where: { claimId: reviewerClaim.id },
    });
    expect(reviewerEvent).toMatchObject({
      decision: "reject",
      actorUserId: reviewerErasure.newUserId,
      note: null,
    });
  });
});
