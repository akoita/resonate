import { ConfigService } from "@nestjs/config";
import { ForbiddenException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { ShowsService } from "../modules/shows/shows.service";
import { MintAuthorizationService } from "../modules/contracts/mint-authorization.service";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import { PayoutEligibilityService } from "../modules/trust/payout-eligibility.service";

/**
 * Payout Eligibility — Integration (Testcontainers, real Prisma) (#1498).
 *
 * Proves the fail-closed gate at both money-bearing seams: an artist who is not
 * human-verified cannot bind themselves as a Shows beneficiary or mint a
 * saleable stem, while an operator-designated beneficiary is not gated, and
 * flipping human verification unblocks the artist with NO process restart.
 *
 * Run: npx jest --runInBand --config jest.integration.config.js \
 *        --testPathPattern='payout-eligibility'
 */

const TEST_PREFIX = `payout_elig_${Date.now()}_`;
const artistUserId = `${TEST_PREFIX}artist_user`;
const operatorUserId = `${TEST_PREFIX}operator`;
const artistId = `${TEST_PREFIX}artist`;
const releaseId = `${TEST_PREFIX}release`;
const trackId = `${TEST_PREFIX}track`;
const stemId = `${TEST_PREFIX}stem`;
const ARTIST_WALLET = `0x${"7".repeat(40)}`;
const OPERATOR_BENEFICIARY = `0x${"4".repeat(40)}`;
const MINTER_ADDRESS = `0x${"11".repeat(20)}`;
const MINT_AUTHORIZER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

const futureIso = (days: number) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
};

function reasonCodes(error: unknown): string[] {
  if (!(error instanceof ForbiddenException)) return [];
  const response = error.getResponse();
  if (response && typeof response === "object" && "reasons" in response) {
    return ((response as { reasons?: Array<{ code: string }> }).reasons ?? []).map(
      (reason) => reason.code,
    );
  }
  return [];
}

describe("Payout eligibility gate (integration)", () => {
  const shows = new ShowsService();
  const payoutEligibility = new PayoutEligibilityService();
  const mintAuthorization = new MintAuthorizationService(
    new ConfigService({ MINT_AUTHORIZER_PRIVATE_KEY }),
    new UploadRightsRoutingService(),
    new RemixEligibilityService(),
  );

  beforeAll(async () => {
    await prisma.user.createMany({
      data: [
        { id: artistUserId, email: `${TEST_PREFIX}artist@test.resonate` },
        { id: operatorUserId, email: `${TEST_PREFIX}operator@test.resonate` },
      ],
    });
    await prisma.artist.create({
      data: {
        id: artistId,
        userId: artistUserId,
        displayName: `${TEST_PREFIX}Artist`,
        payoutAddress: ARTIST_WALLET,
      },
    });
    // Approved rights route (STANDARD_ESCROW ⇒ payout-eligible), so human
    // verification is the ONLY thing gating this artist at the start.
    await prisma.release.create({
      data: {
        id: releaseId,
        artistId,
        title: `${TEST_PREFIX}Ready Release`,
        status: "ready",
        primaryArtist: `${TEST_PREFIX}Artist`,
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: trackId,
        releaseId,
        title: `${TEST_PREFIX}Track`,
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.create({
      data: { id: stemId, trackId, type: "master", uri: `local://${stemId}` },
    });
  });

  afterAll(async () => {
    await prisma.showCampaignEvent.deleteMany({
      where: { campaign: { artistDisplayName: { startsWith: TEST_PREFIX } } },
    }).catch(() => {});
    await prisma.showCampaign.deleteMany({
      where: { artistDisplayName: { startsWith: TEST_PREFIX } },
    }).catch(() => {});
    await prisma.stem.deleteMany({ where: { id: stemId } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: trackId } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: releaseId } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: artistId } }).catch(() => {});
    await prisma.curatorReputation.deleteMany({
      where: { walletAddress: artistUserId.toLowerCase() },
    }).catch(() => {});
    await prisma.user.deleteMany({
      where: { id: { in: [artistUserId, operatorUserId] } },
    }).catch(() => {});
    await prisma.$disconnect();
  });

  function draftInput() {
    return {
      artistId,
      artistDisplayName: `${TEST_PREFIX}Artist`,
      city: "Paris",
      country: "FR",
      deadline: futureIso(30),
      goalAmountUnits: "3000000",
      minimumBackers: 100,
      bookingDeadline: futureIso(45),
    };
  }

  it("blocks an unverified artist at the Shows beneficiary seam", async () => {
    let caught: unknown;
    try {
      await shows.createDraftCampaign(
        { userId: artistUserId, role: "artist" },
        draftInput(),
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    expect(reasonCodes(caught)).toContain("human_verification_required");
  });

  it("blocks the same unverified artist at mint authorization", async () => {
    let caught: unknown;
    try {
      await mintAuthorization.createAuthorization(
        artistUserId,
        { stemId, chainId: 31337, minterAddress: MINTER_ADDRESS } as never,
        "http://localhost:3000",
      );
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ForbiddenException);
    const response =
      caught instanceof ForbiddenException ? caught.getResponse() : null;
    expect((response as { code?: string })?.code).toBe("payout_not_eligible");
    expect(reasonCodes(caught)).toContain("human_verification_required");
  });

  it("does NOT gate an operator-designated beneficiary", async () => {
    // Artist is still unverified here, yet the operator override is allowed.
    const campaign = await shows.createDraftCampaign(
      { userId: operatorUserId, role: "operator" },
      {
        ...draftInput(),
        city: "Lyon",
        beneficiaryAddress: OPERATOR_BENEFICIARY,
        beneficiaryType: "wallet",
      },
    );
    expect(campaign.beneficiaryAddress?.toLowerCase()).toBe(
      OPERATOR_BENEFICIARY.toLowerCase(),
    );
  });

  it("unblocks after human verification WITHOUT a restart", async () => {
    // Same long-lived service instances — no re-instantiation, no restart.
    const before = await payoutEligibility.checkForArtist(artistId);
    expect(before.eligible).toBe(false);

    await prisma.curatorReputation.create({
      data: {
        walletAddress: artistUserId.toLowerCase(),
        humanVerificationStatus: "human_verified",
        verifiedHuman: true,
        humanVerifiedAt: new Date(),
      },
    });

    const after = await payoutEligibility.checkForArtist(artistId);
    expect(after.eligible).toBe(true);
    expect(after.reasons).toHaveLength(0);
    expect(after.inputs.humanVerificationState).toBe("human_verified");
    expect(after.inputs.rightsRoute).toBe("STANDARD_ESCROW");

    // The Shows beneficiary seam now succeeds and binds the artist payout wallet.
    const campaign = await shows.createDraftCampaign(
      { userId: artistUserId, role: "artist" },
      { ...draftInput(), city: "Marseille" },
    );
    expect(campaign.beneficiaryAddress?.toLowerCase()).toBe(
      ARTIST_WALLET.toLowerCase(),
    );
  });
});
