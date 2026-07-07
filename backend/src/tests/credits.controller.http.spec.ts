import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { CreditsController } from "../modules/credits/credits.controller";
import { GenerationCreditsService } from "../modules/credits/generation-credits.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockCreditsService = {
  getBalance: jest.fn().mockResolvedValue({ balanceCents: 250, recentTransactions: [] }),
  grant: jest.fn().mockResolvedValue(500),
  requestOperatorCredits: jest.fn().mockResolvedValue(undefined),
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

    it("allows an admin to grant credits", async () => {
      await request(app.getHttpServer())
        .post("/credits/grant")
        .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
        .send(body)
        .expect(201);
      expect(mockCreditsService.grant).toHaveBeenCalledWith("user-2", 500, "promo_grant");
    });
  });
});
