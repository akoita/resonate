import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { CommunityRoomsService } from "../modules/community/community_rooms.service";
import { ShowsController } from "../modules/shows/shows.controller";
import { ShowsService } from "../modules/shows/shows.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockShowsService = {
  listCampaigns: jest.fn().mockResolvedValue([]),
  getCampaign: jest.fn().mockResolvedValue({ id: "campaign-1" }),
  getCampaignVisual: jest.fn().mockResolvedValue(null),
  getMyPledges: jest.fn().mockResolvedValue([]),
  createSignal: jest.fn(),
  createDraftCampaign: jest.fn(),
  updateDraftCampaign: jest.fn(),
  uploadCampaignVisuals: jest.fn(),
  requestAuthority: jest.fn(),
  approveAuthority: jest.fn(),
  rejectAuthority: jest.fn(),
  revokeAuthority: jest.fn(),
  expireAuthority: jest.fn(),
  activateCampaign: jest.fn(),
  createPledgeIntent: jest.fn(),
  confirmPledge: jest.fn(),
  confirmPledgeRefund: jest.fn(),
  cancelCampaign: jest.fn(),
  confirmBooking: jest.fn(),
  confirmFulfillment: jest.fn(),
};

const mockCommunityRoomsService = {
  getShowCampaignCommunity: jest.fn().mockResolvedValue({
    schemaVersion: "show-campaign-community/v1",
    rooms: [],
  }),
  joinShowCampaignCommunity: jest.fn().mockResolvedValue({
    schemaVersion: "community-membership/v1",
  }),
  createShowCampaignUpdate: jest.fn().mockResolvedValue({
    schemaVersion: "community-message/v1",
  }),
};

describe("ShowsController (http)", () => {
  let app: INestApplication;
  const token = authToken("user-1", "artist");

  beforeAll(async () => {
    app = await createControllerTestApp(ShowsController, [
      { provide: ShowsService, useValue: mockShowsService },
      { provide: CommunityRoomsService, useValue: mockCommunityRoomsService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it("requires JWT for campaign community reads", async () => {
    await request(app.getHttpServer())
      .get("/shows/campaigns/campaign-1/community")
      .expect(401);
  });

  it("loads campaign community state with JWT", async () => {
    await request(app.getHttpServer())
      .get("/shows/campaigns/campaign-1/community")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe("show-campaign-community/v1");
      });

    expect(mockCommunityRoomsService.getShowCampaignCommunity).toHaveBeenCalledWith("user-1", "campaign-1");
  });

  it("joins campaign community with JWT", async () => {
    await request(app.getHttpServer())
      .post("/shows/campaigns/campaign-1/community/join")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(mockCommunityRoomsService.joinShowCampaignCommunity).toHaveBeenCalledWith("user-1", "campaign-1");
  });

  it("posts campaign updates with actor role context", async () => {
    await request(app.getHttpServer())
      .post("/shows/campaigns/campaign-1/community/updates")
      .set("Authorization", `Bearer ${token}`)
      .send({ body: "Campaign update" })
      .expect(201);

    expect(mockCommunityRoomsService.createShowCampaignUpdate).toHaveBeenCalledWith(
      { userId: "user-1", role: "artist" },
      "campaign-1",
      { body: "Campaign update" },
    );
  });
});
