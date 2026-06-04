import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { CommunityController } from "../modules/community/community.controller";
import { CommunityCohortService } from "../modules/community/community_cohort.service";
import { CommunityEligibilityService } from "../modules/community/community_eligibility.service";
import { CommunityRoomsService } from "../modules/community/community_rooms.service";
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

const mockCommunityRoomsService = {
  enableArtistCommunity: jest.fn().mockResolvedValue({ schemaVersion: "community-artist-rooms/v1" }),
  listArtistRooms: jest.fn().mockResolvedValue({ schemaVersion: "community-artist-rooms/v1", rooms: [] }),
  joinRoom: jest.fn().mockResolvedValue({ schemaVersion: "community-membership/v1" }),
  leaveRoom: jest.fn().mockResolvedValue({ schemaVersion: "community-membership/v1" }),
  listMessages: jest.fn().mockResolvedValue({ schemaVersion: "community-messages/v1", messages: [] }),
  createMessage: jest.fn().mockResolvedValue({ schemaVersion: "community-message/v1" }),
  reportMessage: jest.fn().mockResolvedValue({ schemaVersion: "community-moderation-report/v1" }),
  deleteMessage: jest.fn().mockResolvedValue({ schemaVersion: "community-message/v1" }),
  moderateMember: jest.fn().mockResolvedValue({ schemaVersion: "community-membership/v1" }),
  updateRoomStatus: jest.fn().mockResolvedValue({ schemaVersion: "community-room/v1" }),
};

const mockCommunityCohortService = {
  listSuggestions: jest.fn().mockResolvedValue({
    schemaVersion: "community-cohort-suggestions/v1",
    cohorts: [],
  }),
  getCohortDetail: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-detail/v1" }),
  joinCohort: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-membership/v1" }),
  leaveCohort: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-membership/v1" }),
  hideCohort: jest.fn().mockResolvedValue({ schemaVersion: "community-cohort-membership/v1" }),
};

describe("CommunityController (http)", () => {
  let app: INestApplication;
  const token = authToken("user-1");

  beforeAll(async () => {
    app = await createControllerTestApp(CommunityController, [
      { provide: CommunityService, useValue: mockCommunityService },
      { provide: CommunityEligibilityService, useValue: mockCommunityEligibilityService },
      { provide: CommunityRoomsService, useValue: mockCommunityRoomsService },
      { provide: CommunityCohortService, useValue: mockCommunityCohortService },
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

  it("allows public artist room reads without JWT", async () => {
    await request(app.getHttpServer())
      .get("/community/artists/artist-1/rooms")
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe("community-artist-rooms/v1");
      });
  });

  it("loads artist rooms with JWT membership context", async () => {
    await request(app.getHttpServer())
      .get("/community/artists/artist-1/rooms/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(mockCommunityRoomsService.listArtistRooms).toHaveBeenCalledWith("artist-1", "user-1");
  });

  it("requires JWT for room mutations", async () => {
    await request(app.getHttpServer())
      .post("/community/rooms/room-1/join")
      .expect(401);
  });

  it("requires JWT for cohort suggestions", async () => {
    await request(app.getHttpServer())
      .get("/community/cohorts/suggestions")
      .expect(401);
  });

  it("loads and mutates cohort membership with JWT", async () => {
    await request(app.getHttpServer())
      .get("/community/cohorts/suggestions")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe("community-cohort-suggestions/v1");
      });
    await request(app.getHttpServer())
      .get("/community/cohorts/cohort-1")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe("community-cohort-detail/v1");
      });
    await request(app.getHttpServer())
      .post("/community/cohorts/cohort-1/join")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/community/cohorts/cohort-1/leave")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/community/cohorts/cohort-1/hide")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(mockCommunityCohortService.listSuggestions).toHaveBeenCalledWith("user-1");
    expect(mockCommunityCohortService.getCohortDetail).toHaveBeenCalledWith("user-1", "cohort-1");
    expect(mockCommunityCohortService.joinCohort).toHaveBeenCalledWith("user-1", "cohort-1");
    expect(mockCommunityCohortService.leaveCohort).toHaveBeenCalledWith("user-1", "cohort-1");
    expect(mockCommunityCohortService.hideCohort).toHaveBeenCalledWith("user-1", "cohort-1");
  });

  it("enables, joins, posts, reports, and moderates rooms with JWT", async () => {
    await request(app.getHttpServer())
      .post("/community/artists/artist-1/rooms/enable")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/community/rooms/room-1/join")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);
    await request(app.getHttpServer())
      .post("/community/rooms/room-1/messages")
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Hello" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/community/messages/message-1/report")
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "spam" })
      .expect(201);
    await request(app.getHttpServer())
      .post("/community/rooms/room-1/members/user-2/moderate")
      .set("Authorization", `Bearer ${token}`)
      .send({ action: "ban" })
      .expect(201);

    expect(mockCommunityRoomsService.enableArtistCommunity).toHaveBeenCalledWith("user-1", "artist-1");
    expect(mockCommunityRoomsService.createMessage).toHaveBeenCalledWith("user-1", "room-1", { body: "Hello" });
    expect(mockCommunityRoomsService.moderateMember).toHaveBeenCalledWith("user-1", "room-1", "user-2", { action: "ban" });
  });
});
