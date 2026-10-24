/**
 * Admin routes leave rows in the one audit log (#2362), against a real Postgres.
 * The controllers run for real behind the real guards; only their services are
 * stubbed, so what is checked is the interceptor, the describers and the table.
 */
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { CreditsController } from "../modules/credits/credits.controller";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import { DmcaController } from "../modules/dmca/dmca.controller";
import { DmcaService } from "../modules/dmca/dmca.service";
import { MaintenanceController } from "../modules/maintenance/maintenance.controller";
import { MaintenanceService } from "../modules/maintenance/maintenance.service";
import { StemFeatureBackfillService } from "../modules/ingestion/stem-feature-backfill.service";
import { TrackEmbeddingService } from "../modules/embeddings/track_embedding.service";
import { authToken, confirmedBearer, createControllerTestApp } from "./e2e-helpers";

const TEST_PREFIX = `admin_audit_routes_${Date.now()}_`;
const ADMIN = `${TEST_PREFIX}admin`;
const OPERATOR = `${TEST_PREFIX}operator`;
const PERSON = `${TEST_PREFIX}person`;

const credits = {
  grant: jest.fn().mockResolvedValue(500),
  grantCreditRequest: jest.fn().mockResolvedValue({ id: "req-1", userId: PERSON }),
};
const dmca = { resolveReport: jest.fn().mockResolvedValue({ outcome: "upheld" }), listReports: jest.fn().mockResolvedValue([]) };
const maintenance = { wipeReleases: jest.fn().mockResolvedValue({ status: "blocked" }) };

describe("admin route audit rows (integration)", () => {
  let app: INestApplication;
  const rows = (actor: string) => prisma.adminAuditEvent.findMany({ where: { actorUserId: actor }, orderBy: { createdAt: "asc" } });

  beforeAll(async () => {
    app = await createControllerTestApp(
      [CreditsController, DmcaController, MaintenanceController],
      [
        { provide: GenerationCreditsService, useValue: credits },
        { provide: DmcaService, useValue: dmca },
        { provide: MaintenanceService, useValue: maintenance },
        { provide: StemFeatureBackfillService, useValue: {} },
        { provide: TrackEmbeddingService, useValue: {} },
      ],
    );
  });
  afterEach(async () => {
    await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: { in: [ADMIN, OPERATOR] } } });
  });
  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it("a credit grant leaves one row naming the recipient and the amount, never the reason text", async () => {
    await request(app.getHttpServer())
      .post("/credits/grant")
      .set(confirmedBearer(OPERATOR, "operator"))
      .send({ userId: PERSON, amountCents: 700, reason: "a typed free-text reason" })
      .expect(201);
    const [row, ...others] = await rows(OPERATOR);
    expect(others).toEqual([]);
    expect(row).toMatchObject({
      action: "credits.granted",
      outcome: "success",
      targetUserId: PERSON,
      detail: { amountCents: 700 },
    });
    expect(JSON.stringify(row.detail)).not.toContain("free-text");
  });

  it("a granted request names the request holder; a takedown names the report and outcome", async () => {
    await request(app.getHttpServer())
      .post("/credits/requests/req-1/grant")
      .set(confirmedBearer(OPERATOR, "operator"))
      .send({ amountCents: 300 })
      .expect(201);
    await request(app.getHttpServer())
      .patch("/api/dmca/report-9/resolve")
      .set(confirmedBearer(OPERATOR, "operator"))
      .send({ outcome: "upheld" })
      .expect(200);
    const found = await rows(OPERATOR);
    expect(found.map((r) => [r.action, r.targetUserId, r.detail])).toEqual([
      ["credit_request.granted", PERSON, { requestId: "req-1", amountCents: 300 }],
      ["dmca.report_resolved", null, { reportId: "report-9", outcome: "upheld" }],
    ]);
  });

  it("a refused step-up, a refused role and a failed action leave no row", async () => {
    await request(app.getHttpServer())
      .delete("/admin/wipe-releases")
      .set({ Authorization: `Bearer ${authToken(ADMIN, "admin")}` })
      .expect(403);
    await request(app.getHttpServer()).delete("/admin/wipe-releases").set(confirmedBearer(OPERATOR, "operator")).expect(403);
    maintenance.wipeReleases.mockRejectedValueOnce(new Error("db down"));
    await request(app.getHttpServer()).delete("/admin/wipe-releases").set(confirmedBearer(ADMIN, "admin")).expect(500);
    expect(await rows(ADMIN)).toEqual([]);
    expect(await rows(OPERATOR)).toEqual([]);
  });

  it("a successful wipe leaves a row, and reading the dmca queue leaves a viewed row", async () => {
    await request(app.getHttpServer()).delete("/admin/wipe-releases").set(confirmedBearer(ADMIN, "admin")).expect(200);
    await request(app.getHttpServer())
      .get("/api/dmca?status=pending")
      .set({ Authorization: `Bearer ${authToken(ADMIN, "admin")}` })
      .expect(200);
    expect((await rows(ADMIN)).map((r) => [r.action, r.detail])).toEqual([
      ["maintenance.releases_wiped", null],
      ["dmca.reports_viewed", { status: "pending" }],
    ]);
  });
});
