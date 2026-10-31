import request from "supertest";
import { BadRequestException, INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { BillingReconciliationController } from "../modules/billing/billing_reconciliation.controller";
import { BillingReconciliationService } from "../modules/billing/billing_reconciliation.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const REPORT = {
  reportVersion: "billing-reconciliation/v1",
  month: "2026-06",
  creditPacks: {
    purchases: [
      {
        creditTopUpId: "p1",
        accountId: "u1",
        stripeCheckoutSessionId: "cs_1",
        stripePaymentIntentId: "pi_1",
        packId: "pack_a",
        currency: "usd",
        priceCents: 500,
        amountTotalCents: 600,
        creditsCents: 500,
        delivery: "deliver_now",
        paidAt: "2026-06-03T10:00:00.000Z",
        creditedAt: "2026-06-03T10:00:01.000Z",
        creditedInMonthCents: 500,
        currentStatus: "credited",
      },
    ],
    refunds: [],
    needsReview: [],
  },
};
const mockService = { build: jest.fn() };

describe("BillingReconciliationController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(BillingReconciliationController, [
      { provide: BillingReconciliationService, useValue: mockService },
      RolesGuard,
    ]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    mockService.build.mockResolvedValue(REPORT);
  });

  const get = (path: string, userId = "admin-1", role = "admin") =>
    request(app.getHttpServer()).get(path).set("Authorization", `Bearer ${authToken(userId, role)}`);

  it("requires a JWT", async () => {
    await request(app.getHttpServer()).get("/admin/billing/reconciliation/2026-06").expect(401);
    expect(mockService.build).not.toHaveBeenCalled();
  });

  it.each(["listener", "artist"])("refuses a %s with 403", async (role) => {
    await get("/admin/billing/reconciliation/2026-06", "user-1", role).expect(403);
    expect(mockService.build).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it.each(["admin", "operator"])("returns the JSON report to an %s, never cached", async (role) => {
    const res = await get("/admin/billing/reconciliation/2026-06", "op-1", role).expect(200);
    expect(res.body).toEqual(REPORT);
    expect(res.headers["cache-control"]).toBe("no-store");
    expect(mockService.build).toHaveBeenCalledWith("2026-06");
  });

  it("returns one section as CSV with attachment headers", async () => {
    const res = await get("/admin/billing/reconciliation/2026-06?format=csv&section=purchases").expect(200);
    expect(res.headers["content-type"]).toMatch(/^text\/csv; charset=utf-8/);
    expect(res.headers["content-disposition"]).toBe(
      'attachment; filename="billing-reconciliation-2026-06-purchases.csv"',
    );
    expect(res.headers["cache-control"]).toBe("no-store");
    const lines = res.text.split("\r\n");
    expect(lines[0].startsWith("creditTopUpId,accountId,")).toBe(true);
    expect(lines[1].startsWith("p1,u1,cs_1,pi_1,pack_a,usd,500,600,500,deliver_now,")).toBe(true);
  });

  it("rejects an unknown format or section with 400", async () => {
    await get("/admin/billing/reconciliation/2026-06?format=xml").expect(400);
    await get("/admin/billing/reconciliation/2026-06?format=csv&section=bogus").expect(400);
    await get("/admin/billing/reconciliation/2026-06?format=json&format=csv").expect(400);
    expect(mockService.build).not.toHaveBeenCalled();
  });

  it("requires a section for csv", async () => {
    const res = await get("/admin/billing/reconciliation/2026-06?format=csv").expect(400);
    expect(res.body.code).toBe("section_required");
    expect(mockService.build).not.toHaveBeenCalled();
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("passes the service's month errors through as 400", async () => {
    mockService.build.mockRejectedValueOnce(new BadRequestException({ code: "invalid_month" }));
    const res = await get("/admin/billing/reconciliation/2026-13").expect(400);
    expect(res.body.code).toBe("invalid_month");
    expect(mockAudit).not.toHaveBeenCalled();
  });

  it("records the view in the admin audit log with ids and codes only", async () => {
    await get("/admin/billing/reconciliation/2026-06?format=csv&section=refunds", "op-7", "operator").expect(200);
    expect(mockAudit).toHaveBeenCalledTimes(1);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        actorUserId: "op-7",
        action: "billing.reconciliation_viewed",
        detail: { month: "2026-06", format: "csv", section: "refunds" },
      }),
    );
  });
});
