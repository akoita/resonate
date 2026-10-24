import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { TrustController } from "../modules/trust/trust.controller";
import { TrustService } from "../modules/trust/trust.service";
import { PayoutEligibilityService } from "../modules/trust/payout-eligibility.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, createControllerTestApp } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

/**
 * HTTP contract for the self-serve payout-eligibility endpoint (#1498).
 * Services are mocked — this test asserts routing, the JWT guard, and the
 * explainable response shape (never a 404 for an artist-less user).
 */

const mockTrustService = {
  getStakeRequirement: jest.fn(),
  getCreatorVerificationRecord: jest.fn(),
  setVerified: jest.fn(),
};

const mockPayoutEligibilityService = {
  checkForUser: jest.fn(),
};

describe("TrustController payout-eligibility (http)", () => {
  let app: INestApplication;
  const token = authToken("user-artist", "artist");

  beforeAll(async () => {
    app = await createControllerTestApp(TrustController, [
      { provide: TrustService, useValue: mockTrustService },
      {
        provide: PayoutEligibilityService,
        useValue: mockPayoutEligibilityService,
      },
      RolesGuard,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it("requires a JWT", async () => {
    await request(app.getHttpServer())
      .get("/api/trust/me/payout-eligibility")
      .expect(401);
    expect(mockPayoutEligibilityService.checkForUser).not.toHaveBeenCalled();
  });

  it("returns the explainable eligibility shape with a JWT", async () => {
    mockPayoutEligibilityService.checkForUser.mockResolvedValue({
      artistId: "artist-1",
      eligible: false,
      reasons: [
        {
          code: "human_verification_required",
          message: "This account is not human-verified, so it cannot receive payouts yet.",
          resolution: "Complete the human-verification check on your artist profile.",
        },
      ],
      inputs: {
        humanVerificationState: "unverified",
        rightsReviewState: "approved_with_limits",
        payoutRelease: "standard",
        rightsFlags: [],
        rightsRoute: "STANDARD_ESCROW",
        hasReleases: true,
      },
    });

    await request(app.getHttpServer())
      .get("/api/trust/me/payout-eligibility")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.eligible).toBe(false);
        expect(res.body.reasons[0].code).toBe("human_verification_required");
        expect(res.body.reasons[0].resolution.length).toBeGreaterThan(0);
        expect(res.body.inputs.humanVerificationState).toBe("unverified");
      });

    expect(mockPayoutEligibilityService.checkForUser).toHaveBeenCalledWith(
      "user-artist",
    );
  });

  it("returns artist_profile_required (not 404) for a user with no artist", async () => {
    mockPayoutEligibilityService.checkForUser.mockResolvedValue({
      artistId: null,
      eligible: false,
      reasons: [
        {
          code: "artist_profile_required",
          message: "You do not have an artist profile yet, so payouts cannot be enabled.",
          resolution: "Create your artist profile and set a payout address.",
        },
      ],
      inputs: null,
    });

    await request(app.getHttpServer())
      .get("/api/trust/me/payout-eligibility")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.artistId).toBeNull();
        expect(res.body.eligible).toBe(false);
        expect(res.body.reasons[0].code).toBe("artist_profile_required");
      });
  });

  it("records an admin verifying an artist, and refuses everyone else (#2362)", async () => {
    mockTrustService.setVerified.mockResolvedValue({ artistId: "artist-1", tier: "verified" });
    await request(app.getHttpServer())
      .post("/api/trust/artist-1/verify")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);
    await request(app.getHttpServer())
      .post("/api/trust/artist-1/verify")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .expect(403);
    expect(mockAudit).not.toHaveBeenCalled();

    await request(app.getHttpServer())
      .post("/api/trust/artist-1/verify")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(201);
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: "admin-1",
      action: "trust.artist_verified",
      targetUserId: null,
      detail: { artistId: "artist-1" },
    });
  });
});
