/**
 * Audit records for the admin routes without a spec of their own (#2362):
 * metadata review queues, catalog credit identity, artist claims, agents and
 * curation. Services are stubbed; the real guards and interceptor run.
 */
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { AgentEvaluationService } from "../modules/agents/agent_evaluation.service";
import { AgentGoldenEvalService } from "../modules/agents/agent_golden_eval.service";
import { AgentOrchestratorService } from "../modules/agents/agent_orchestrator.service";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { AgentRunnerService } from "../modules/agents/agent_runner.service";
import { AgentsController } from "../modules/agents/agents.controller";
import { ArtistController } from "../modules/artist/artist.controller";
import { ArtistService } from "../modules/artist/artist.service";
import { CatalogController } from "../modules/catalog/catalog.controller";
import { CatalogService } from "../modules/catalog/catalog.service";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";
import { ContractsService } from "../modules/contracts/contracts.service";
import { IndexerService } from "../modules/contracts/indexer.service";
import { MetadataController } from "../modules/contracts/metadata.controller";
import { CurationController } from "../modules/curation/curation.controller";
import { CurationService } from "../modules/curation/curation.service";
import { NotificationService } from "../modules/notifications/notification.service";
import { RightsRouteReassessmentService } from "../modules/rights/rights-route-reassessment.service";
import { TrustedSourceService } from "../modules/rights/trusted-source.service";
import { EventBus } from "../modules/shared/event_bus";
import { authToken, createControllerTestApp } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const admin = { Authorization: `Bearer ${authToken("admin-1", "admin")}` };
const operator = { Authorization: `Bearer ${authToken("operator-1", "operator")}` };
const listener = { Authorization: `Bearer ${authToken("user-1", "listener")}` };
const event = (action: string, detail?: Record<string, unknown>, actor = "admin-1") => ({
  actorUserId: actor,
  action,
  targetUserId: null,
  ...(detail ? { detail } : {}),
});

describe("metadata admin queues (http)", () => {
  let app: INestApplication;
  const rights = {
    createReassessment: jest.fn().mockResolvedValue({ id: "ra-1" }),
    sampleLowFrictionAudits: jest.fn().mockResolvedValue({ created: 2 }),
    listPendingReassessments: jest.fn().mockResolvedValue([]),
    reviewReassessment: jest.fn().mockResolvedValue({ id: "ra-1" }),
    createTrustedSourceRevocationReassessments: jest.fn().mockResolvedValue([]),
  };
  const trusted = {
    listPendingLinkRequests: jest.fn().mockResolvedValue([]),
    reviewLinkRequest: jest.fn().mockResolvedValue({ id: "lr-1" }),
    revokeArtistLink: jest.fn().mockResolvedValue({ id: "link-1", artistId: "a-1", sourceType: "distributor" }),
  };
  const contracts = {
    listPendingReleaseRightsUpgradeRequests: jest.fn().mockResolvedValue([]),
    getReleaseRightsUpgradeRequestById: jest.fn().mockResolvedValue({ id: "rr-1" }),
  };

  beforeAll(async () => {
    app = await createControllerTestApp(MetadataController, [
      { provide: ContractsService, useValue: contracts },
      { provide: IndexerService, useValue: {} },
      { provide: NotificationService, useValue: {} },
      { provide: EventBus, useValue: { publish: jest.fn() } },
      { provide: RightsRouteReassessmentService, useValue: rights },
      { provide: TrustedSourceService, useValue: trusted },
    ]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ["post", "/metadata/rights-reassessments/releases/rel-1", { reason: "free text" }, "rights_reassessment.created", { releaseId: "rel-1" }],
    ["post", "/metadata/rights-reassessments/audit-sample", { limit: 5, reason: "free text" }, "rights_reassessment.audit_sampled", { limit: 5 }],
    ["get", "/metadata/rights-reassessments/pending", undefined, "rights_reassessments.viewed", undefined],
    [
      "patch",
      "/metadata/rights-reassessments/ra-1/review",
      { action: "dismiss", reason: "free text" },
      "rights_reassessment.reviewed",
      { reassessmentId: "ra-1", action: "dismiss" },
    ],
    ["get", "/metadata/trusted-sources/link-requests/pending", undefined, "trusted_source_link_requests.viewed", undefined],
    [
      "patch",
      "/metadata/trusted-sources/link-requests/lr-1/review",
      { action: "approve", decisionReason: "free text" },
      "trusted_source_link.reviewed",
      { requestId: "lr-1", action: "approve" },
    ],
    ["patch", "/metadata/trusted-sources/links/link-1/revoke", { reason: "free text" }, "trusted_source_link.revoked", { linkId: "link-1" }],
    ["get", "/metadata/release-rights/requests/pending", undefined, "release_rights_requests.viewed", undefined],
    ["get", "/metadata/release-rights/requests/rr-1", undefined, "release_rights_request.viewed", { requestId: "rr-1" }],
  ])("%s %s records %s", async (method, path, body, action, detail) => {
    const call = (request(app.getHttpServer()) as any)[method](path).set(admin);
    await (body ? call.send(body) : call).expect((res: any) => expect(res.status).toBeLessThan(300));
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(event(action, detail));
  });

  it("records nothing for a non-admin or a failed review", async () => {
    await request(app.getHttpServer()).get("/metadata/rights-reassessments/pending").set(operator).expect(403);
    trusted.reviewLinkRequest.mockRejectedValueOnce(new Error("boom"));
    await request(app.getHttpServer())
      .patch("/metadata/trusted-sources/link-requests/lr-1/review")
      .set(admin)
      .send({ action: "deny" })
      .expect(500);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("catalog and artist admin actions (http)", () => {
  let app: INestApplication;
  const catalog = { reviewCreditIdentity: jest.fn().mockResolvedValue({ id: "credit-1" }) };
  const artists = {
    listPendingClaims: jest.fn().mockResolvedValue([]),
    reviewClaim: jest.fn().mockResolvedValue({ id: "claim-1" }),
  };

  beforeAll(async () => {
    app = await createControllerTestApp(
      [CatalogController, ArtistController],
      [
        { provide: CatalogService, useValue: catalog },
        { provide: DiscoveryPopularityService, useValue: {} },
        { provide: ArtistService, useValue: artists },
      ],
    );
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it("records a credit identity review with the credit and artist ids, not the note", async () => {
    await request(app.getHttpServer())
      .patch("/catalog/credits/credit-1/identity")
      .set(operator)
      .send({ artistId: "artist-7", note: "free text" })
      .expect(200);
    expect(mockAudit).toHaveBeenCalledWith(event("catalog_credit.identity_reviewed", { creditId: "credit-1", artistId: "artist-7" }, "operator-1"));
  });

  it("records opening the pending claims and each decision with its code", async () => {
    await request(app.getHttpServer()).get("/artists/claims/pending").set(operator).expect(200);
    await request(app.getHttpServer())
      .patch("/artists/claims/claim-1")
      .set(operator)
      .send({ decision: "approve", note: "free text" })
      .expect(200);
    expect(mockAudit).toHaveBeenNthCalledWith(1, event("artist_claims.viewed", undefined, "operator-1"));
    expect(mockAudit).toHaveBeenNthCalledWith(2, event("artist_claim.reviewed", { claimId: "claim-1", decision: "approve" }, "operator-1"));
  });

  it("records nothing for a listener or a rejected claim review", async () => {
    await request(app.getHttpServer()).get("/artists/claims/pending").set(listener).expect(403);
    artists.reviewClaim.mockRejectedValueOnce(new Error("nope"));
    await request(app.getHttpServer()).patch("/artists/claims/claim-1").set(operator).send({ decision: "reject" }).expect(500);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});

describe("agents and curation admin actions (http)", () => {
  let app: INestApplication;
  const ok = () => jest.fn().mockResolvedValue({ ok: true });
  const runner = { run: ok() };
  const orchestrator = { orchestrate: ok() };
  const evaluator = { evaluate: ok() };
  const golden = { run: ok() };
  const runtime = { run: ok() };
  const curation = { stake: jest.fn(), getStake: jest.fn(), report: jest.fn(), listReports: jest.fn().mockReturnValue([]) };

  beforeAll(async () => {
    app = await createControllerTestApp(
      [AgentsController, CurationController],
      [
        { provide: AgentRunnerService, useValue: runner },
        { provide: AgentOrchestratorService, useValue: orchestrator },
        { provide: AgentEvaluationService, useValue: evaluator },
        { provide: AgentGoldenEvalService, useValue: golden },
        { provide: AgentRuntimeService, useValue: runtime },
        { provide: CurationService, useValue: curation },
      ],
    );
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => jest.clearAllMocks());

  it("records the golden evaluation run and the curation report listing", async () => {
    await request(app.getHttpServer()).post("/agents/evaluate/golden").set(admin).expect(201);
    await request(app.getHttpServer()).get("/curation/reports").set(admin).expect(200);
    expect(mockAudit).toHaveBeenNthCalledWith(1, event("agents.golden_eval_run"));
    expect(mockAudit).toHaveBeenNthCalledWith(2, event("curation.reports_viewed"));
  });

  it("does not record a curator's own stake lookup, and refuses an operator on the agents routes", async () => {
    await request(app.getHttpServer())
      .get("/curation/stake/c-1")
      .set({ Authorization: `Bearer ${authToken("curator-1", "curator")}` })
      .expect(200);
    await request(app.getHttpServer()).post("/agents/evaluate/golden").set(operator).expect(403);
    expect(mockAudit).not.toHaveBeenCalled();
  });
});
