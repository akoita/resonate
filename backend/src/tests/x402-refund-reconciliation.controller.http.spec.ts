import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { X402RefundReconciliationController } from "../modules/punchline/x402-refund-reconciliation.controller";
import { X402RefundReconciliationService } from "../modules/punchline/x402-refund-reconciliation.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, confirmedBearer as confirmed, createControllerTestApp, expectStepUpRequired } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const mockService = {
  listRefundDue: jest.fn().mockResolvedValue([
    {
      id: "settlement-1",
      receiptId: "x402r_1",
      payerAddress: "0xpayer",
      paymentTransactionHash: "0xtx",
      settlementAmount: "1.50",
      settlementAmountUnits: "1500000",
      paymentAssetSymbol: "USDC",
      canonicalAmountUsd: "1.50",
      momentId: "moment-1",
      momentTitle: "Sold-out punchline",
      reason: "paid_but_unfulfilled:sold_out",
      createdAt: new Date("2026-07-13T00:00:00.000Z"),
      ageHours: 3.5,
    },
  ]),
  markRefunded: jest.fn().mockResolvedValue({ id: "settlement-1", status: "refunded" }),
};

const REFUND_TX = `0x${"f".repeat(64)}`;

describe("X402RefundReconciliationController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(X402RefundReconciliationController, [
      { provide: X402RefundReconciliationService, useValue: mockService },
      RolesGuard,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe("GET /admin/x402-refunds", () => {
    it("requires a JWT", async () => {
      await request(app.getHttpServer()).get("/admin/x402-refunds").expect(401);
    });

    it("rejects a non-operator (listener) with 403", async () => {
      await request(app.getHttpServer())
        .get("/admin/x402-refunds")
        .set("Authorization", `Bearer ${authToken("user-1", "listener")}`)
        .expect(403);
      expect(mockService.listRefundDue).not.toHaveBeenCalled();
    });

    it("lets an operator list refund_due settlements", async () => {
      await request(app.getHttpServer())
        .get("/admin/x402-refunds")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toHaveLength(1);
          expect(res.body[0]).toMatchObject({ id: "settlement-1", ageHours: 3.5 });
        });
      expect(mockService.listRefundDue).toHaveBeenCalledTimes(1);
      expect(mockAudit).toHaveBeenCalledWith({ actorUserId: "operator-1", action: "x402_refunds.viewed", targetUserId: null });
    });

    it("lets an admin list refund_due settlements", async () => {
      await request(app.getHttpServer())
        .get("/admin/x402-refunds")
        .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
        .expect(200);
      expect(mockService.listRefundDue).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /admin/x402-refunds/:id/mark-refunded", () => {
    const body = { refundTxHash: REFUND_TX };

    it("requires a JWT", async () => {
      await request(app.getHttpServer())
        .post("/admin/x402-refunds/settlement-1/mark-refunded")
        .send(body)
        .expect(401);
    });

    it("needs a fresh step-up proof: none, stale or someone else's is a 403 and nothing is recorded (#2380)", async () => {
      await expectStepUpRequired(app, "post", "/admin/x402-refunds/settlement-1/mark-refunded", { userId: "operator-9", role: "operator" }, body);
      await expectStepUpRequired(app, "post", "/admin/x402-refunds/settlement-1/mark-refunded", { userId: "admin-1", role: "admin" }, body);
      expect(mockService.markRefunded).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it("rejects a non-operator (artist) with 403", async () => {
      await request(app.getHttpServer())
        .post("/admin/x402-refunds/settlement-1/mark-refunded")
        .set("Authorization", `Bearer ${authToken("user-1", "artist")}`)
        .send(body)
        .expect(403);
      expect(mockService.markRefunded).not.toHaveBeenCalled();
    });

    it("lets an operator mark a settlement refunded, passing the actor from the JWT", async () => {
      await request(app.getHttpServer())
        .post("/admin/x402-refunds/settlement-1/mark-refunded")
        .set(confirmed("operator-9", "operator"))
        .send(body)
        .expect(201)
        .expect((res) => {
          expect(res.body).toMatchObject({ id: "settlement-1", status: "refunded" });
        });
      expect(mockService.markRefunded).toHaveBeenCalledWith(
        "settlement-1",
        REFUND_TX,
        "operator-9",
      );
    });

    it("records the settlement and the refund hash, never anything else from the body (#2362)", async () => {
      await request(app.getHttpServer())
        .post("/admin/x402-refunds/settlement-1/mark-refunded")
        .set(confirmed("operator-9", "operator"))
        .send({ ...body, note: "free text" })
        .expect(201);
      expect(mockAudit).toHaveBeenCalledTimes(1);
      expect(mockAudit).toHaveBeenCalledWith({
        actorUserId: "operator-9",
        action: "x402_refund.marked_refunded",
        targetUserId: null,
        detail: { settlementId: "settlement-1", refundTxHash: REFUND_TX },
      });
    });

    it("class DTO: rejects a non-string hash with 400 and records nothing (#2362)", async () => {
      await request(app.getHttpServer())
        .post("/admin/x402-refunds/settlement-1/mark-refunded")
        .set(confirmed("operator-9", "operator"))
        .send({ refundTxHash: 5 })
        .expect(400);
      expect(mockService.markRefunded).not.toHaveBeenCalled();
      expect(mockAudit).not.toHaveBeenCalled();
    });

    it("class DTO: a missing hash still reaches the service, which answers with its own message", async () => {
      await request(app.getHttpServer())
        .post("/admin/x402-refunds/settlement-1/mark-refunded")
        .set(confirmed("operator-9", "operator"))
        .send({})
        .expect(201);
      expect(mockService.markRefunded).toHaveBeenCalledWith("settlement-1", "", "operator-9");
    });
  });
});
