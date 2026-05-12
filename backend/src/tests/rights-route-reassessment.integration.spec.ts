import { prisma } from "../db/prisma";
import { RightsRouteReassessmentService } from "../modules/rights/rights-route-reassessment.service";

const P = `rights_reassess_${Date.now()}_`;

describe("RightsRouteReassessmentService (integration)", () => {
  const service = new RightsRouteReassessmentService();
  const userId = `${P}user`;
  const artistId = `${P}artist`;
  const standardReleaseId = `${P}standard_release`;
  const standardTrackId = `${P}standard_track`;
  const trustedReleaseId = `${P}trusted_release`;
  const trustedTrackId = `${P}trusted_track`;
  const trustedSourceId = `${P}trusted_source`;
  const trustedLinkId = `${P}trusted_link`;

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${P}artist@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: "Route Reassessment Artist",
        payoutAddress: "0x" + "7".repeat(40),
      },
    });
    await prisma.release.create({
      data: {
        id: standardReleaseId,
        artistId,
        title: "Standard Escrow Release",
        status: "published",
        rightsRoute: "STANDARD_ESCROW",
        rightsFlags: [],
        rightsReason: "Approved under standard escrow.",
        rightsPolicyVersion: "2026-04-08.v1",
        rightsSourceType: "direct_upload",
        rightsEvaluatedAt: new Date("2026-05-01T00:00:00Z"),
      },
    });
    await prisma.track.create({
      data: {
        id: standardTrackId,
        releaseId: standardReleaseId,
        title: "Standard Track",
        rightsRoute: "STANDARD_ESCROW",
        rightsFlags: [],
        rightsReason: "Approved under standard escrow.",
        rightsPolicyVersion: "2026-04-08.v1",
        rightsEvaluatedAt: new Date("2026-05-01T00:00:00Z"),
      },
    });
    await prisma.release.create({
      data: {
        id: trustedReleaseId,
        artistId,
        title: "Trusted Label Release",
        status: "published",
        rightsRoute: "TRUSTED_FAST_PATH",
        rightsFlags: [],
        rightsReason: "Approved label source.",
        rightsPolicyVersion: "2026-04-08.v1",
        rightsSourceType: "trusted_label",
        rightsEvaluatedAt: new Date("2026-05-02T00:00:00Z"),
      },
    });
    await prisma.track.create({
      data: {
        id: trustedTrackId,
        releaseId: trustedReleaseId,
        title: "Trusted Track",
        rightsRoute: "TRUSTED_FAST_PATH",
        rightsFlags: [],
        rightsReason: "Approved label source.",
        rightsPolicyVersion: "2026-04-08.v1",
        rightsEvaluatedAt: new Date("2026-05-02T00:00:00Z"),
      },
    });
    await prisma.trustedSource.create({
      data: {
        id: trustedSourceId,
        type: "label",
        name: "Trusted Label",
        sourceKey: `${P}trusted-label`,
        trustLevel: "high",
        reviewState: "active",
      },
    });
    await prisma.trustedSourceArtistLink.create({
      data: {
        id: trustedLinkId,
        artistId,
        trustedSourceId,
        status: "active",
        trustLevel: "high",
        sourceType: "label",
      },
    });
  });

  afterAll(async () => {
    await prisma.rightsRouteReassessment.deleteMany({
      where: { releaseId: { in: [standardReleaseId, trustedReleaseId] } },
    }).catch(() => {});
    await prisma.rightsEvidence.deleteMany({
      where: { subjectId: standardReleaseId },
    }).catch(() => {});
    await prisma.rightsEvidenceBundle.deleteMany({
      where: { subjectId: standardReleaseId },
    }).catch(() => {});
    await prisma.trustedSourceArtistLink.deleteMany({ where: { id: trustedLinkId } }).catch(() => {});
    await prisma.trustedSource.deleteMany({ where: { id: trustedSourceId } }).catch(() => {});
    await prisma.track.deleteMany({
      where: { id: { in: [standardTrackId, trustedTrackId] } },
    }).catch(() => {});
    await prisma.release.deleteMany({
      where: { id: { in: [standardReleaseId, trustedReleaseId] } },
    }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: artistId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  });

  it("samples low-friction releases for audit review", async () => {
    const samples = await service.sampleLowFrictionAudits({
      limit: 2,
      actorAddress: "0xadmin",
    });

    expect(samples.map((sample) => sample.releaseId)).toEqual([
      standardReleaseId,
      trustedReleaseId,
    ]);
    expect(samples[0]).toMatchObject({
      trigger: "audit_sample",
      status: "pending_review",
      previousRoute: "STANDARD_ESCROW",
      recommendedRoute: "STANDARD_ESCROW",
    });
  });

  it("applies admin route reassessments to release and tracks", async () => {
    const reassessment = await service.createReassessment({
      releaseId: standardReleaseId,
      trigger: "fingerprint_conflict",
      recommendedRoute: "QUARANTINED_REVIEW",
      reason: "New fingerprint conflict requires manual review.",
      actorAddress: "0xadmin",
    });

    const reviewed = await service.reviewReassessment({
      reassessmentId: reassessment.id,
      action: "apply_route",
      reviewedBy: "0xadmin",
      reason: "Fingerprint conflict confirmed by ops.",
    });

    expect(reviewed.status).toBe("applied");
    expect(reviewed.nextRoute).toBe("QUARANTINED_REVIEW");

    const release = await prisma.release.findUniqueOrThrow({
      where: { id: standardReleaseId },
      select: { rightsRoute: true, rightsFlags: true, rightsReason: true },
    });
    const track = await prisma.track.findUniqueOrThrow({
      where: { id: standardTrackId },
      select: { rightsRoute: true },
    });

    expect(release.rightsRoute).toBe("QUARANTINED_REVIEW");
    expect(release.rightsFlags).toContain("RESTRICT_MARKETPLACE");
    expect(release.rightsReason).toContain("Fingerprint conflict confirmed");
    expect(track.rightsRoute).toBe("QUARANTINED_REVIEW");
  });

  it("creates a pending reassessment when new release evidence arrives", async () => {
    const bundle = await prisma.rightsEvidenceBundle.create({
      data: {
        subjectType: "release",
        subjectId: standardReleaseId,
        submittedByRole: "creator",
        submittedByAddress: userId,
        purpose: "creator_response",
        summary: "Creator supplied new provenance details.",
      },
    });

    const reassessment = await service.createReassessmentFromEvidenceBundle(bundle);

    expect(reassessment).toMatchObject({
      releaseId: standardReleaseId,
      trigger: "evidence_submitted",
      status: "pending_review",
      evidenceSubjectType: "release",
      evidenceSubjectId: standardReleaseId,
    });
  });

  it("downgrades trusted fast-path releases when the linked source is revoked", async () => {
    const applied = await service.createTrustedSourceRevocationReassessments({
      linkId: trustedLinkId,
      artistId,
      sourceType: "label",
      revokedBy: "0xadmin",
      reason: "Label dashboard access was revoked.",
    });

    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      trigger: "trusted_source_revoked",
      status: "applied",
      previousRoute: "TRUSTED_FAST_PATH",
      nextRoute: "STANDARD_ESCROW",
    });

    const release = await prisma.release.findUniqueOrThrow({
      where: { id: trustedReleaseId },
      select: { rightsRoute: true, rightsReason: true },
    });
    const track = await prisma.track.findUniqueOrThrow({
      where: { id: trustedTrackId },
      select: { rightsRoute: true },
    });

    expect(release.rightsRoute).toBe("STANDARD_ESCROW");
    expect(release.rightsReason).toContain("Label dashboard access was revoked");
    expect(track.rightsRoute).toBe("STANDARD_ESCROW");
  });
});
