import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { X402RefundReconciliationController } from "../modules/punchline/x402-refund-reconciliation.controller";
import { X402RefundReconciliationService } from "../modules/punchline/x402-refund-reconciliation.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

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
        .set("Authorization", `Bearer ${authToken("operator-9", "operator")}`)
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
  });
});
