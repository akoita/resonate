import request from "supertest";
import { BadRequestException, INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
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
  resyncCampaignFromChain: jest.fn(),
  discoverOnChainCampaign: jest.fn(),
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
  joinShowCampaignCityDemand: jest.fn().mockResolvedValue({
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
      RolesGuard,
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

  it("joins campaign city demand with JWT", async () => {
    await request(app.getHttpServer())
      .post("/shows/campaigns/campaign-1/community/city-interest/join")
      .set("Authorization", `Bearer ${token}`)
      .expect(201);

    expect(mockCommunityRoomsService.joinShowCampaignCityDemand).toHaveBeenCalledWith("user-1", "campaign-1");
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

  it("rejects listener role for campaign updates", async () => {
    await request(app.getHttpServer())
      .post("/shows/campaigns/campaign-1/community/updates")
      .set("Authorization", `Bearer ${authToken("user-1", "listener")}`)
      .send({ body: "Campaign update" })
      .expect(403);

    expect(mockCommunityRoomsService.createShowCampaignUpdate).not.toHaveBeenCalled();
  });

  it("re-syncs campaign chain state for operators", async () => {
    mockShowsService.resyncCampaignFromChain.mockResolvedValue({ id: "campaign-1" });

    await request(app.getHttpServer())
      .post("/shows/campaigns/campaign-1/resync-chain")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.id).toBe("campaign-1");
      });

    expect(mockShowsService.resyncCampaignFromChain).toHaveBeenCalledWith(
      { userId: "operator-1", role: "operator" },
      "campaign-1",
    );
  });

  it("rejects listener role for campaign chain re-sync", async () => {
    await request(app.getHttpServer())
      .post("/shows/campaigns/campaign-1/resync-chain")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(403);

    expect(mockShowsService.resyncCampaignFromChain).not.toHaveBeenCalled();
  });

  // #1356: contract-invalid terms surface as HTTP 400 from create and approval.
  it("surfaces terms-validation BadRequest as HTTP 400 on draft create", async () => {
    mockShowsService.createDraftCampaign.mockRejectedValue(
      new BadRequestException("bookingDeadline must be after the funding deadline"),
    );

    await request(app.getHttpServer())
      .post("/shows/campaigns")
      .set("Authorization", `Bearer ${token}`)
      .send({ artistDisplayName: "Test", city: "Lyon", country: "FR", deadline: "2999-01-01T00:00:00.000Z" })
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toContain("bookingDeadline must be after");
      });
  });

  it("surfaces approval terms-validation BadRequest as HTTP 400", async () => {
    mockShowsService.approveAuthority.mockRejectedValue(
      new BadRequestException("Cannot approve authority: deadline must be in the future. Edit the draft to fix the campaign terms before approving."),
    );

    await request(app.getHttpServer())
      .patch("/shows/campaigns/campaign-1/authority")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .send({ authorityStatus: "artist_authorized" })
      .expect(400)
      .expect((res) => {
        expect(res.body.message).toContain("Cannot approve authority");
      });
  });

  it("discovers the on-chain campaign for operators", async () => {
    mockShowsService.discoverOnChainCampaign.mockResolvedValue({
      escrowAddress: "0x" + "e".repeat(40),
      matches: [],
    });

    await request(app.getHttpServer())
      .post("/shows/campaigns/campaign-1/discover-onchain")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .expect(201)
      .expect((res) => {
        expect(res.body.matches).toEqual([]);
      });

    expect(mockShowsService.discoverOnChainCampaign).toHaveBeenCalledWith(
      { userId: "operator-1", role: "operator" },
      "campaign-1",
    );
  });

  it("rejects listener role for on-chain discovery", async () => {
    await request(app.getHttpServer())
      .post("/shows/campaigns/campaign-1/discover-onchain")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(403);

    expect(mockShowsService.discoverOnChainCampaign).not.toHaveBeenCalled();
  });
});
