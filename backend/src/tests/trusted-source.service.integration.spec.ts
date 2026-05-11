import { prisma } from "../db/prisma";
import { TrustedSourceService } from "../modules/rights/trusted-source.service";

const P = `trusted_source_${Date.now()}_`;

describe("TrustedSourceService (integration)", () => {
  const service = new TrustedSourceService();
  const userId = `${P}user`;
  const artistId = `${P}artist`;
  const requesterAddress = userId.toLowerCase();

  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${P}artist@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId,
        displayName: "Trusted Link Artist",
        payoutAddress: "0x" + "6".repeat(40),
      },
    });
  });

  afterAll(async () => {
    const requests = await prisma.trustedSourceLinkRequest.findMany({
      where: { artistId },
      select: { id: true },
    });
    const requestIds = requests.map((request) => request.id);
    await prisma.rightsEvidence.deleteMany({
      where: { subjectType: "trusted_source_link_request", subjectId: { in: requestIds } },
    }).catch(() => {});
    await prisma.rightsEvidenceBundle.deleteMany({
      where: { subjectType: "trusted_source_link_request", subjectId: { in: requestIds } },
    }).catch(() => {});
    await prisma.trustedSourceArtistLink.deleteMany({
      where: { artistId },
    }).catch(() => {});
    await prisma.trustedSourceLinkRequest.deleteMany({
      where: { artistId },
    }).catch(() => {});
    await prisma.trustedSource.deleteMany({
      where: { sourceKey: `${P}distributor` },
    }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: artistId } }).catch(() => {});
    await prisma.user.deleteMany({ where: { id: userId } }).catch(() => {});
  });

  it("submits a source-link request with structured evidence", async () => {
    const request = await service.submitLinkRequest({
      requesterAddress,
      requestedSourceType: "distributor",
      sourceName: "Distributor Portal",
      sourceKey: `${P}distributor`,
      requestedTrustLevel: "high",
      proofSummary: "This artist controls the distributor dashboard for the uploaded catalog.",
      domain: "distributor.test",
      feedUrl: "https://distributor.test/catalog.xml",
      traceability: { catalogId: `${P}catalog` },
      evidences: [
        {
          kind: "proof_of_control",
          title: "Distributor dashboard control",
          sourceUrl: "https://distributor.test/dashboard",
          claimedRightsholder: "Trusted Link Artist",
          strength: "high",
        },
      ],
    });

    expect(request.status).toBe("submitted");
    expect(request.trustedSource?.reviewState).toBe("pending_review");
    expect(request.trustedSource?.domain).toBe("distributor.test");
    expect(request.evidenceBundles).toHaveLength(1);
    expect(request.evidenceBundles[0].evidences[0].kind).toBe("proof_of_control");
  });

  it("approves source-link requests and exposes active routing context", async () => {
    const pending = await prisma.trustedSourceLinkRequest.findFirstOrThrow({
      where: { artistId, sourceKey: `${P}distributor` },
      orderBy: { createdAt: "desc" },
    });

    const reviewed = await service.reviewLinkRequest({
      id: pending.id,
      action: "approve",
      reviewedBy: "0xadmin",
      trustLevel: "high",
      decisionReason: "Distributor dashboard and catalog traceability checked.",
    });

    expect(reviewed.status).toBe("approved");
    expect(reviewed.trustedSource?.reviewState).toBe("active");

    const context = await service.getActiveTrustedSourceContext(artistId);
    expect(context).toMatchObject({
      sourceType: "trusted_distributor",
      sourceName: "Distributor Portal",
      trustLevel: "high",
    });
  });

  it("revokes artist links so they no longer affect routing context", async () => {
    const link = await prisma.trustedSourceArtistLink.findFirstOrThrow({
      where: { artistId, status: "active" },
    });

    await service.revokeArtistLink({
      linkId: link.id,
      revokedBy: "0xadmin",
      reason: "Catalog feed access was removed.",
    });

    await expect(service.getActiveTrustedSourceContext(artistId)).resolves.toBeNull();
  });
});
