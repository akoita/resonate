import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { CommunityController } from "../modules/community/community.controller";
import { CommunityEligibilityService } from "../modules/community/community_eligibility.service";
import { CommunityService } from "../modules/community/community.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockCommunityService = {
  getMyProfile: jest.fn().mockResolvedValue({
    schemaVersion: "community-profile/v1",
    profile: { displayName: "Ada" },
  }),
  updateMyProfile: jest.fn().mockResolvedValue({
    schemaVersion: "community-profile/v1",
    profile: { displayName: "Ada" },
  }),
  getPublicProfile: jest.fn().mockResolvedValue({
    schemaVersion: "community-public-profile/v1",
    profile: { displayName: "Ada" },
  }),
};

const mockCommunityEligibilityService = {
  listMyBadges: jest.fn().mockResolvedValue({
    schemaVersion: "community-badges/v1",
    badges: [],
  }),
  listMyBenefits: jest.fn().mockResolvedValue({
    schemaVersion: "community-benefits/v1",
    benefits: [],
  }),
  redeemBenefit: jest.fn().mockResolvedValue({
    schemaVersion: "community-benefit-redemption/v1",
  }),
};

describe("CommunityController (http)", () => {
  let app: INestApplication;
  const token = authToken("user-1");

  beforeAll(async () => {
    app = await createControllerTestApp(CommunityController, [
      { provide: CommunityService, useValue: mockCommunityService },
      { provide: CommunityEligibilityService, useValue: mockCommunityEligibilityService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it("requires JWT for self profile reads", async () => {
    await request(app.getHttpServer())
      .get("/community/profile/me")
      .expect(401);
  });

  it("loads self profile with JWT", async () => {
    await request(app.getHttpServer())
      .get("/community/profile/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe("community-profile/v1");
      });
  });

  it("updates self profile with JWT", async () => {
    await request(app.getHttpServer())
      .patch("/community/profile/me")
      .set("Authorization", `Bearer ${token}`)
      .send({ displayName: "Ada", profileVisibility: "public" })
      .expect(200);

    expect(mockCommunityService.updateMyProfile).toHaveBeenCalledWith("user-1", {
      displayName: "Ada",
      profileVisibility: "public",
    });
  });

  it("allows public profile reads without JWT", async () => {
    await request(app.getHttpServer())
      .get("/community/profile/user-2")
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe("community-public-profile/v1");
      });
  });

  it("requires JWT for badge reads", async () => {
    await request(app.getHttpServer())
      .get("/community/badges/me")
      .expect(401);
  });

  it("loads badges with JWT", async () => {
    await request(app.getHttpServer())
      .get("/community/badges/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe("community-badges/v1");
      });
  });

  it("loads benefits with JWT", async () => {
    await request(app.getHttpServer())
      .get("/community/benefits/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe("community-benefits/v1");
      });
  });

  it("redeems benefits with JWT", async () => {
    await request(app.getHttpServer())
      .post("/community/benefits/benefit-1/redeem")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(mockCommunityEligibilityService.redeemBenefit).toHaveBeenCalledWith("user-1", "benefit-1");
  });
});
