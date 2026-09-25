import request from "supertest";
import {
  ConflictException,
  ForbiddenException,
  INestApplication,
  NotFoundException,
} from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { CreditsController } from "../modules/credits/credits.controller";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockCreditsService = {
  getBalance: jest.fn().mockResolvedValue({ balanceCents: 250, recentTransactions: [] }),
  grant: jest.fn().mockResolvedValue(500),
  requestOperatorCredits: jest.fn().mockResolvedValue(undefined),
  listCreditRequests: jest.fn().mockResolvedValue([]),
  grantCreditRequest: jest.fn(),
  dismissCreditRequest: jest.fn(),
};

const REQUEST_ROW = {
  id: "req-1",
  userId: "user-2",
  note: "out of credits",
  status: "granted",
  requestedAt: "2026-09-25T10:00:00.000Z",
  resolvedAt: "2026-09-25T11:00:00.000Z",
  resolvedBy: "operator-1",
  grantedCents: 500,
  resolutionNote: "Credit request top-up",
  balanceCents: 500,
};

describe("CreditsController (http)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(CreditsController, [
      { provide: GenerationCreditsService, useValue: mockCreditsService },
      RolesGuard,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe("GET /credits/balance", () => {
    it("requires a JWT", async () => {
      await request(app.getHttpServer()).get("/credits/balance").expect(401);
    });

    it("returns the caller's balance when authenticated", async () => {
      await request(app.getHttpServer())
        .get("/credits/balance")
        .set("Authorization", `Bearer ${authToken("user-1", "listener")}`)
        .expect(200)
        .expect((res) => {
          expect(res.body.balanceCents).toBe(250);
        });
      expect(mockCreditsService.getBalance).toHaveBeenCalledWith("user-1");
    });
  });

  describe("POST /credits/request", () => {
    it("requires a JWT", async () => {
      await request(app.getHttpServer()).post("/credits/request").send({}).expect(401);
    });

    it("lets any authenticated user ask an operator for credits (from the JWT identity)", async () => {
      await request(app.getHttpServer())
        .post("/credits/request")
        .set("Authorization", `Bearer ${authToken("user-9", "listener")}`)
        .send({ note: "trying the Afrobeat preset" })
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual({ status: "notified" });
        });
      expect(mockCreditsService.requestOperatorCredits).toHaveBeenCalledWith(
        "user-9",
        "trying the Afrobeat preset",
      );
    });

    it("rejects a note over 280 characters with 400", async () => {
      await request(app.getHttpServer())
        .post("/credits/request")
        .set("Authorization", `Bearer ${authToken("user-9", "listener")}`)
        .send({ note: "x".repeat(281) })
        .expect(400);
      expect(mockCreditsService.requestOperatorCredits).not.toHaveBeenCalled();
    });

    it("accepts a request with no note", async () => {
      await request(app.getHttpServer())
        .post("/credits/request")
        .set("Authorization", `Bearer ${authToken("user-9", "artist")}`)
        .send({})
        .expect(201);
      expect(mockCreditsService.requestOperatorCredits).toHaveBeenCalledWith("user-9", undefined);
    });
  });

  describe("POST /credits/grant", () => {
    const body = { userId: "user-2", amountCents: 500, reason: "promo_grant" };

    it("requires a JWT", async () => {
      await request(app.getHttpServer()).post("/credits/grant").send(body).expect(401);
    });

    it("rejects a non-operator (listener) with 403", async () => {
      await request(app.getHttpServer())
        .post("/credits/grant")
        .set("Authorization", `Bearer ${authToken("user-1", "listener")}`)
        .send(body)
        .expect(403);
      expect(mockCreditsService.grant).not.toHaveBeenCalled();
    });

    it("rejects an artist (non-operator) with 403", async () => {
      await request(app.getHttpServer())
        .post("/credits/grant")
        .set("Authorization", `Bearer ${authToken("user-1", "artist")}`)
        .send(body)
        .expect(403);
      expect(mockCreditsService.grant).not.toHaveBeenCalled();
    });

    it("allows an operator to grant credits", async () => {
      await request(app.getHttpServer())
        .post("/credits/grant")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .send(body)
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual({ userId: "user-2", balanceCents: 500 });
        });
      expect(mockCreditsService.grant).toHaveBeenCalledWith("user-2", 500, "promo_grant");
    });

    it.each([
      ["a zero amount", { ...body, amountCents: 0 }],
      ["a fractional amount", { ...body, amountCents: 12.5 }],
      ["a string amount", { ...body, amountCents: "500" }],
      ["an amount over the cap", { ...body, amountCents: 10_000_001 }],
      ["a missing userId", { amountCents: 500, reason: "promo_grant" }],
      ["a missing reason", { userId: "user-2", amountCents: 500 }],
    ])("rejects %s with 400", async (_label, invalid) => {
      await request(app.getHttpServer())
        .post("/credits/grant")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .send(invalid)
        .expect(400);
      expect(mockCreditsService.grant).not.toHaveBeenCalled();
    });

    it("allows an admin to grant credits", async () => {
      await request(app.getHttpServer())
        .post("/credits/grant")
        .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
        .send(body)
        .expect(201);
      expect(mockCreditsService.grant).toHaveBeenCalledWith("user-2", 500, "promo_grant");
    });
  });

  describe("GET /credits/requests", () => {
    it("requires a JWT", async () => {
      await request(app.getHttpServer()).get("/credits/requests").expect(401);
    });

    it.each(["listener", "artist"])("rejects a %s with 403", async (role) => {
      await request(app.getHttpServer())
        .get("/credits/requests")
        .set("Authorization", `Bearer ${authToken("user-1", role)}`)
        .expect(403);
      expect(mockCreditsService.listCreditRequests).not.toHaveBeenCalled();
    });

    it("defaults to the pending queue for an operator", async () => {
      mockCreditsService.listCreditRequests.mockResolvedValueOnce([REQUEST_ROW]);
      await request(app.getHttpServer())
        .get("/credits/requests")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .expect(200)
        .expect((res) => {
          expect(res.body).toEqual([REQUEST_ROW]);
        });
      expect(mockCreditsService.listCreditRequests).toHaveBeenCalledWith("pending");
    });

    it.each(["pending", "resolved", "all"])("passes status=%s through for an admin", async (status) => {
      await request(app.getHttpServer())
        .get(`/credits/requests?status=${status}`)
        .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
        .expect(200);
      expect(mockCreditsService.listCreditRequests).toHaveBeenCalledWith(status);
    });

    it("rejects an unknown status filter with 400", async () => {
      await request(app.getHttpServer())
        .get("/credits/requests?status=granted")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .expect(400);
      expect(mockCreditsService.listCreditRequests).not.toHaveBeenCalled();
    });
  });

  describe("POST /credits/requests/:id/grant", () => {
    it("requires a JWT", async () => {
      await request(app.getHttpServer())
        .post("/credits/requests/req-1/grant")
        .send({ amountCents: 500 })
        .expect(401);
    });

    it("rejects a non-operator with 403", async () => {
      await request(app.getHttpServer())
        .post("/credits/requests/req-1/grant")
        .set("Authorization", `Bearer ${authToken("user-1", "listener")}`)
        .send({ amountCents: 500 })
        .expect(403);
      expect(mockCreditsService.grantCreditRequest).not.toHaveBeenCalled();
    });

    it("grants as the calling operator and returns the resolved row", async () => {
      mockCreditsService.grantCreditRequest.mockResolvedValueOnce(REQUEST_ROW);
      await request(app.getHttpServer())
        .post("/credits/requests/req-1/grant")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .send({ amountCents: 500, reason: "welcome top-up" })
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual(REQUEST_ROW);
        });
      expect(mockCreditsService.grantCreditRequest).toHaveBeenCalledWith(
        "req-1",
        "operator-1",
        500,
        "welcome top-up",
      );
    });

    it("lets the reason default (passes undefined)", async () => {
      mockCreditsService.grantCreditRequest.mockResolvedValueOnce(REQUEST_ROW);
      await request(app.getHttpServer())
        .post("/credits/requests/req-1/grant")
        .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
        .send({ amountCents: 10_000_000 })
        .expect(201);
      expect(mockCreditsService.grantCreditRequest).toHaveBeenCalledWith(
        "req-1",
        "admin-1",
        10_000_000,
        undefined,
      );
    });

    it.each([
      ["zero", { amountCents: 0 }],
      ["negative", { amountCents: -5 }],
      ["over the cap", { amountCents: 10_000_001 }],
      ["fractional", { amountCents: 12.5 }],
      ["a string", { amountCents: "500" }],
      ["missing", {}],
      ["a reason over 120 chars", { amountCents: 500, reason: "r".repeat(121) }],
    ])("rejects an amount that is %s with 400", async (_label, body) => {
      await request(app.getHttpServer())
        .post("/credits/requests/req-1/grant")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .send(body)
        .expect(400);
      expect(mockCreditsService.grantCreditRequest).not.toHaveBeenCalled();
    });

    it("surfaces the service's 409 when the request is no longer pending", async () => {
      mockCreditsService.grantCreditRequest.mockRejectedValueOnce(
        new ConflictException({ code: "request_not_pending", message: "already granted" }),
      );
      await request(app.getHttpServer())
        .post("/credits/requests/req-1/grant")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .send({ amountCents: 500 })
        .expect(409)
        .expect((res) => {
          expect(res.body.code).toBe("request_not_pending");
        });
    });

    it("surfaces the service's 403 when an operator tries to grant their own request", async () => {
      mockCreditsService.grantCreditRequest.mockRejectedValueOnce(
        new ForbiddenException({
          code: "self_review_forbidden",
          message: "You can't resolve your own credit request.",
        }),
      );
      await request(app.getHttpServer())
        .post("/credits/requests/req-own/grant")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .send({ amountCents: 500 })
        .expect(403)
        .expect((res) => {
          expect(res.body).toMatchObject({
            code: "self_review_forbidden",
            message: "You can't resolve your own credit request.",
          });
        });
      expect(mockCreditsService.grantCreditRequest).toHaveBeenCalledWith(
        "req-own",
        "operator-1",
        500,
        undefined,
      );
    });

    it("surfaces the service's 404 for an unknown request", async () => {
      mockCreditsService.grantCreditRequest.mockRejectedValueOnce(
        new NotFoundException({ code: "request_not_found", message: "nope" }),
      );
      await request(app.getHttpServer())
        .post("/credits/requests/missing/grant")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .send({ amountCents: 500 })
        .expect(404);
    });
  });

  describe("POST /credits/requests/:id/dismiss", () => {
    it("rejects a non-operator with 403", async () => {
      await request(app.getHttpServer())
        .post("/credits/requests/req-1/dismiss")
        .set("Authorization", `Bearer ${authToken("user-1", "artist")}`)
        .send({})
        .expect(403);
      expect(mockCreditsService.dismissCreditRequest).not.toHaveBeenCalled();
    });

    it("dismisses as the calling operator with an optional note", async () => {
      const dismissed = { ...REQUEST_ROW, status: "dismissed", grantedCents: null, resolutionNote: "dup" };
      mockCreditsService.dismissCreditRequest.mockResolvedValueOnce(dismissed);
      await request(app.getHttpServer())
        .post("/credits/requests/req-1/dismiss")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .send({ note: "dup" })
        .expect(201)
        .expect((res) => {
          expect(res.body).toEqual(dismissed);
        });
      expect(mockCreditsService.dismissCreditRequest).toHaveBeenCalledWith("req-1", "operator-1", "dup");
    });

    it("rejects a note over 280 characters with 400", async () => {
      await request(app.getHttpServer())
        .post("/credits/requests/req-1/dismiss")
        .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
        .send({ note: "n".repeat(281) })
        .expect(400);
      expect(mockCreditsService.dismissCreditRequest).not.toHaveBeenCalled();
    });
  });
});
