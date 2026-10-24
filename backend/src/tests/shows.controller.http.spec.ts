import request from "supertest";
import { BadRequestException, ForbiddenException, INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { CommunityRoomsService } from "../modules/community/community_rooms.service";
import { ShowsController } from "../modules/shows/shows.controller";
import { ShowRefundReminderService } from "../modules/shows/show-refund-reminder.service";
import { ShowsService } from "../modules/shows/shows.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, confirmedBearer as confirmed, createControllerTestApp, expectStepUpRequired } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const mockShowsService = {
  listCampaigns: jest.fn().mockResolvedValue([]),
  getCampaign: jest.fn().mockResolvedValue({ id: "campaign-1" }),
  getCampaignVisual: jest.fn().mockResolvedValue(null),
  getManagedCampaign: jest.fn(),
  getMyPledges: jest.fn().mockResolvedValue([]),
  createSignal: jest.fn(),
  createDraftCampaign: jest.fn(),
  updateDraftCampaign: jest.fn(),
  uploadCampaignVisuals: jest.fn(),
  reorderCampaignVisuals: jest.fn(),
  replaceCampaignVisual: jest.fn(),
  deleteCampaignVisual: jest.fn(),
  requestAuthority: jest.fn(),
  approveAuthority: jest.fn(),
  rejectAuthority: jest.fn(),
  revokeAuthority: jest.fn(),
  expireAuthority: jest.fn(),
  activateCampaign: jest.fn(),
  resyncCampaignFromChain: jest.fn(),
  discoverOnChainCampaign: jest.fn(),
  listReconciliationMismatches: jest.fn(),
  acknowledgeReconciliationMismatch: jest.fn(),
  removeReconciliationAcknowledgement: jest.fn(),
  createPledgeIntent: jest.fn(),
  confirmPledge: jest.fn(),
  confirmPledgeRefund: jest.fn(),
  cancelCampaign: jest.fn(),
  confirmBooking: jest.fn(),
  confirmFulfillment: jest.fn(),
  initiateDispute: jest.fn(),
  resolveDispute: jest.fn(),
};

const mockRefundReminders = {
  getUnclaimedRefunds: jest.fn(),
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
  // #2128: real artists sign in with the `listener` role; no `artist` role is issued.
  const token = authToken("user-1", "listener");

  beforeAll(async () => {
    app = await createControllerTestApp(ShowsController, [
      { provide: ShowsService, useValue: mockShowsService },
      { provide: CommunityRoomsService, useValue: mockCommunityRoomsService },
      { provide: ShowRefundReminderService, useValue: mockRefundReminders },
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

  it("serves versioned campaign visuals with the legacy public cache semantics", async () => {
    mockShowsService.getCampaignVisual.mockResolvedValue({
      data: Buffer.from("visual"),
      mimeType: "image/webp",
    });

    const res = await request(app.getHttpServer())
      .get("/shows/campaigns/campaign-1/visuals/card/v4")
      .expect(200);

    expect(res.headers["content-type"]).toContain("image/webp");
    expect(res.headers["cache-control"]).toBe("public, max-age=300");
    expect(mockShowsService.getCampaignVisual).toHaveBeenCalledWith("campaign-1", "card", "4");
  });

  it("loads campaign community state with JWT", async () => {
    await request(app.getHttpServer())
      .get("/shows/campaigns/campaign-1/community")
      .set("Authorization", `Bearer ${token}`)
      .expect(200)
      .expect((res) => {
        expect(res.body.schemaVersion).toBe("show-campaign-community/v1");
      });

    expect(mockCommunityRoomsService.getShowCampaignCommunity).toHaveBeenCalledWith("user-1", "campaign-1", "listener");
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
      { userId: "user-1", role: "listener" },
      "campaign-1",
      { body: "Campaign update" },
    );
  });

  it("returns the service's ownership refusal for campaign updates by a non-owner", async () => {
    mockCommunityRoomsService.createShowCampaignUpdate.mockRejectedValueOnce(
      new ForbiddenException("Artist community management is restricted to the artist owner or operators"),
    );

    await request(app.getHttpServer())
      .post("/shows/campaigns/campaign-1/community/updates")
      .set("Authorization", `Bearer ${authToken("stranger-1", "listener")}`)
      .send({ body: "Campaign update" })
      .expect(403)
      .expect((res) => {
        expect(res.body.message).toContain("restricted to the artist owner");
      });

    expect(mockCommunityRoomsService.createShowCampaignUpdate).toHaveBeenCalledWith(
      { userId: "stranger-1", role: "listener" },
      "campaign-1",
      { body: "Campaign update" },
    );
  });

  // #2128: the artist-side routes authorize by ownership in the service, not by a
  // JWT role. A listener-role JWT must reach the service; unauthenticated requests
  // are still refused by AuthGuard("jwt").
  describe("artist-side routes authorize by ownership, not JWT role (#2128)", () => {
    type Route = {
      name: string;
      method: "get" | "post" | "patch" | "delete";
      path: string;
      service: jest.Mock;
      status: number;
      body?: Record<string, unknown>;
    };
    const routes: Route[] = [
      { name: "manage read", method: "get", path: "/shows/campaigns/campaign-1/manage", service: mockShowsService.getManagedCampaign, status: 200 },
      { name: "campaign update post", method: "post", path: "/shows/campaigns/campaign-1/community/updates", service: mockCommunityRoomsService.createShowCampaignUpdate, status: 201, body: { body: "Update" } },
      { name: "draft create", method: "post", path: "/shows/campaigns", service: mockShowsService.createDraftCampaign, status: 201, body: { city: "Lyon" } },
      { name: "draft update", method: "patch", path: "/shows/campaigns/campaign-1", service: mockShowsService.updateDraftCampaign, status: 200, body: { city: "Lyon" } },
      { name: "visual upload", method: "patch", path: "/shows/campaigns/campaign-1/visuals", service: mockShowsService.uploadCampaignVisuals, status: 200 },
      { name: "visual reorder", method: "patch", path: "/shows/campaigns/campaign-1/visuals/order", service: mockShowsService.reorderCampaignVisuals, status: 200, body: { visualIds: ["v1"] } },
      { name: "visual replace", method: "patch", path: "/shows/campaigns/campaign-1/visuals/hero", service: mockShowsService.replaceCampaignVisual, status: 200 },
      { name: "visual delete", method: "delete", path: "/shows/campaigns/campaign-1/visuals/hero", service: mockShowsService.deleteCampaignVisual, status: 200 },
      { name: "authority request", method: "post", path: "/shows/campaigns/campaign-1/request-authority", service: mockShowsService.requestAuthority, status: 201, body: {} },
      { name: "activation", method: "post", path: "/shows/campaigns/campaign-1/activate", service: mockShowsService.activateCampaign, status: 201, body: {} },
      { name: "cancellation", method: "post", path: "/shows/campaigns/campaign-1/cancel", service: mockShowsService.cancelCampaign, status: 201, body: {} },
    ];

    it.each(routes)("lets a listener-role JWT reach the service for $name", async (route) => {
      route.service.mockResolvedValueOnce({ id: "campaign-1" });

      let req = request(app.getHttpServer())[route.method](route.path)
        .set("Authorization", `Bearer ${authToken("artist-owner-1", "listener")}`);
      if (route.body) req = req.send(route.body);
      await req.expect(route.status);

      expect(route.service).toHaveBeenCalledTimes(1);
      expect(route.service.mock.calls[0][0]).toEqual({ userId: "artist-owner-1", role: "listener" });
    });

    it.each(routes)("surfaces the service's ownership refusal as 403 for $name", async (route) => {
      route.service.mockRejectedValueOnce(
        new ForbiddenException("Only the campaign artist or an operator can update this campaign"),
      );

      let req = request(app.getHttpServer())[route.method](route.path)
        .set("Authorization", `Bearer ${authToken("stranger-1", "listener")}`);
      if (route.body) req = req.send(route.body);
      await req.expect(403).expect((res) => {
        expect(res.body.message).toContain("Only the campaign artist or an operator");
      });

      expect(route.service).toHaveBeenCalledTimes(1);
    });

    it.each(routes)("still requires a JWT for $name", async (route) => {
      let req = request(app.getHttpServer())[route.method](route.path);
      if (route.body) req = req.send(route.body);
      await req.expect(401);

      expect(route.service).not.toHaveBeenCalled();
    });
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

  // #1271: operator reconciliation-mismatch read (drill assertion surface).
  it("lists reconciliation mismatches for operators with parsed query params", async () => {
    mockShowsService.listReconciliationMismatches.mockResolvedValue([
      {
        occurredAt: "2026-07-13T00:00:00.000Z",
        contractCampaignId: "42",
        escrowEventName: "Pledged",
        transactionHash: "0x" + "a".repeat(64),
        blockNumber: "1000",
        reason: "on-chain pledge from 0xabc (99) has no matching backend intent",
      },
    ]);

    await request(app.getHttpServer())
      .get("/shows/operator/reconciliation-mismatches?contractCampaignId=42&sinceMinutes=60&limit=10")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toHaveLength(1);
        expect(res.body[0].reason).toContain("no matching backend intent");
      });

    expect(mockShowsService.listReconciliationMismatches).toHaveBeenCalledWith(
      { userId: "operator-1", role: "operator" },
      { contractCampaignId: "42", sinceMinutes: 60, limit: 10 },
    );
  });

  it("allows admin role for reconciliation mismatches", async () => {
    mockShowsService.listReconciliationMismatches.mockResolvedValue([]);

    await request(app.getHttpServer())
      .get("/shows/operator/reconciliation-mismatches")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .expect(200);

    expect(mockShowsService.listReconciliationMismatches).toHaveBeenCalledWith(
      { userId: "admin-1", role: "admin" },
      { contractCampaignId: undefined, sinceMinutes: undefined, limit: undefined },
    );
  });

  it("requires JWT for reconciliation mismatches", async () => {
    await request(app.getHttpServer())
      .get("/shows/operator/reconciliation-mismatches")
      .expect(401);

    expect(mockShowsService.listReconciliationMismatches).not.toHaveBeenCalled();
  });

  it("rejects listener role for reconciliation mismatches", async () => {
    await request(app.getHttpServer())
      .get("/shows/operator/reconciliation-mismatches")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(403);

    expect(mockShowsService.listReconciliationMismatches).not.toHaveBeenCalled();
  });

  it("lists unclaimed refunds for operators and passes the campaign filter", async () => {
    mockRefundReminders.getUnclaimedRefunds.mockResolvedValue({ campaigns: [], generatedAt: "now" });

    await request(app.getHttpServer())
      .get("/shows/operator/unclaimed-refunds?campaignId=campaign-1")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .expect(200);

    expect(mockRefundReminders.getUnclaimedRefunds).toHaveBeenCalledWith(
      { userId: "operator-1", role: "operator" },
      { campaignId: "campaign-1" },
    );
  });

  it("requires JWT and an operator role for unclaimed refunds", async () => {
    await request(app.getHttpServer()).get("/shows/operator/unclaimed-refunds").expect(401);
    await request(app.getHttpServer())
      .get("/shows/operator/unclaimed-refunds")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(403);

    expect(mockRefundReminders.getUnclaimedRefunds).not.toHaveBeenCalled();
  });

  it("acknowledges an exact reconciliation identity for operators", async () => {
    const contractAddress = "0x" + "a".repeat(40);
    mockShowsService.acknowledgeReconciliationMismatch.mockResolvedValue({
      chainId: 84532,
      contractAddress,
      contractCampaignId: "42",
      acknowledged: true,
    });

    await request(app.getHttpServer())
      .post("/shows/operator/reconciliation-mismatches/42/acknowledge")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .send({ chainId: 84532, contractAddress, note: "Known staging artifact" })
      .expect(201)
      .expect((res) => expect(res.body.acknowledged).toBe(true));

    expect(mockShowsService.acknowledgeReconciliationMismatch).toHaveBeenCalledWith(
      { userId: "operator-1", role: "operator" },
      "42",
      { chainId: 84532, contractAddress, note: "Known staging artifact" },
    );
  });

  it("removes a reconciliation acknowledgement idempotently for admins", async () => {
    const contractAddress = "0x" + "b".repeat(40);
    mockShowsService.removeReconciliationAcknowledgement.mockResolvedValue({
      chainId: 84532,
      contractAddress,
      contractCampaignId: "42",
      acknowledged: false,
    });

    await request(app.getHttpServer())
      .delete("/shows/operator/reconciliation-mismatches/42/acknowledgement")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .send({ chainId: 84532, contractAddress })
      .expect(200)
      .expect((res) => expect(res.body.acknowledged).toBe(false));

    expect(mockShowsService.removeReconciliationAcknowledgement).toHaveBeenCalledWith(
      { userId: "admin-1", role: "admin" },
      "42",
      { chainId: 84532, contractAddress },
    );
  });

  it("protects acknowledgement mutations with JWT and operator roles", async () => {
    const postRoute = "/shows/operator/reconciliation-mismatches/42/acknowledge";
    const deleteRoute = "/shows/operator/reconciliation-mismatches/42/acknowledgement";
    await request(app.getHttpServer()).post(postRoute).send({}).expect(401);
    await request(app.getHttpServer())
      .post(postRoute)
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({})
      .expect(403);
    await request(app.getHttpServer()).delete(deleteRoute).send({}).expect(401);
    await request(app.getHttpServer())
      .delete(deleteRoute)
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({})
      .expect(403);
    expect(mockShowsService.acknowledgeReconciliationMismatch).not.toHaveBeenCalled();
    expect(mockShowsService.removeReconciliationAcknowledgement).not.toHaveBeenCalled();
  });
});

describe("ShowsController operator actions are audited (#2362)", () => {
  let app: INestApplication;
  const operator = { Authorization: `Bearer ${authToken("operator-1", "operator")}` };
  const listener = { Authorization: `Bearer ${authToken("user-1", "listener")}` };

  beforeAll(async () => {
    app = await createControllerTestApp(ShowsController, [
      { provide: ShowsService, useValue: mockShowsService },
      { provide: CommunityRoomsService, useValue: mockCommunityRoomsService },
      { provide: ShowRefundReminderService, useValue: mockRefundReminders },
      RolesGuard,
    ]);
  });
  afterAll(async () => {
    await app.close();
  });
  // Earlier suites leave rejecting implementations on the shared service mock.
  beforeEach(() => jest.resetAllMocks());

  it.each([
    ["patch", "/shows/campaigns/c-1/authority", "show_authority.approved", { campaignId: "c-1" }],
    ["post", "/shows/campaigns/c-1/reject-authority", "show_authority.rejected", { campaignId: "c-1" }],
    ["post", "/shows/campaigns/c-1/revoke-authority", "show_authority.revoked", { campaignId: "c-1" }],
    ["post", "/shows/campaigns/c-1/expire-authority", "show_authority.expired", { campaignId: "c-1" }],
    ["post", "/shows/campaigns/c-1/resync-chain", "show_campaign.chain_resynced", { campaignId: "c-1" }],
    ["post", "/shows/campaigns/c-1/discover-onchain", "show_campaign.onchain_discovered", { campaignId: "c-1" }],
    ["post", "/shows/campaigns/c-1/dispute", "show_dispute.opened", { campaignId: "c-1" }],
    [
      "post",
      "/shows/operator/reconciliation-mismatches/7/acknowledge",
      "show_reconciliation.acknowledged",
      { contractCampaignId: "7" },
    ],
    [
      "delete",
      "/shows/operator/reconciliation-mismatches/7/acknowledgement",
      "show_reconciliation.acknowledgement_removed",
      { contractCampaignId: "7" },
    ],
  ])("%s %s records %s with ids only", async (method, path, action, detail) => {
    await (request(app.getHttpServer()) as any)[method](path).set(operator).send({ note: "free text" }).expect((res: any) => {
      expect(res.status).toBeLessThan(300);
    });
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith({ actorUserId: "operator-1", action, targetUserId: null, detail });
  });

  // #2380: the three money-release actions need a fresh step-up proof.
  it.each([
    ["post", "/shows/campaigns/c-1/confirm-booking", {}],
    ["post", "/shows/campaigns/c-1/confirm-fulfillment", {}],
    ["patch", "/shows/campaigns/c-1/dispute/d-1/resolve", { outcome: "upheld" }],
  ] as const)("%s %s needs a fresh step-up proof, for operators and admins", async (method, path, body) => {
    await expectStepUpRequired(app, method, path, { userId: "operator-1", role: "operator" }, body);
    await expectStepUpRequired(app, method, path, { userId: "admin-1", role: "admin" }, body);
    expect(mockShowsService.confirmBooking).not.toHaveBeenCalled();
    expect(mockShowsService.confirmFulfillment).not.toHaveBeenCalled();
    expect(mockShowsService.resolveDispute).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it.each([
    ["post", "/shows/campaigns/c-1/confirm-booking", "show_campaign.booking_confirmed", { campaignId: "c-1" }],
    ["post", "/shows/campaigns/c-1/confirm-fulfillment", "show_campaign.fulfillment_confirmed", { campaignId: "c-1" }],
  ] as const)("%s %s with a proof reaches the service and records %s with ids only", async (method, path, action, detail) => {
    await (request(app.getHttpServer()) as any)[method](path)
      .set(confirmed("operator-1", "operator"))
      .send({ note: "free text" })
      .expect(201);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith({ actorUserId: "operator-1", action, targetUserId: null, detail });
    const service = path.endsWith("confirm-booking") ? mockShowsService.confirmBooking : mockShowsService.confirmFulfillment;
    expect(service).toHaveBeenCalledWith({ userId: "operator-1", role: "operator" }, "c-1", { note: "free text" });
  });

  it("records a dispute resolution with its outcome code and ids, not the operator note", async () => {
    await request(app.getHttpServer())
      .patch("/shows/campaigns/c-1/dispute/d-1/resolve")
      .set(confirmed("operator-1", "operator"))
      .send({ outcome: "upheld", operatorNote: "free text" })
      .expect(200);
    expect(mockAudit).toHaveBeenCalledWith({
      actorUserId: "operator-1",
      action: "show_dispute.resolved",
      targetUserId: null,
      detail: { campaignId: "c-1", disputeId: "d-1", outcome: "upheld" },
    });
  });

  it("records nothing for a refused role, a failed action, or the aggregate reads", async () => {
    await request(app.getHttpServer()).post("/shows/campaigns/c-1/confirm-booking").set(listener).send({}).expect(403);
    mockShowsService.confirmBooking.mockRejectedValueOnce(new BadRequestException("not ready"));
    await request(app.getHttpServer()).post("/shows/campaigns/c-1/confirm-booking").set(confirmed("operator-1", "operator")).send({}).expect(400);
    mockShowsService.listReconciliationMismatches.mockResolvedValueOnce([]);
    mockRefundReminders.getUnclaimedRefunds.mockResolvedValueOnce([]);
    await request(app.getHttpServer()).get("/shows/operator/reconciliation-mismatches").set(operator).expect(200);
    await request(app.getHttpServer()).get("/shows/operator/unclaimed-refunds").set(operator).expect(200);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
