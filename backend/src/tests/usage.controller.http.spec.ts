import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { UsageController } from "../modules/usage/usage.controller";
import { UsageService } from "../modules/usage/usage.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const usageService = {
  getSummary: jest.fn(),
};

describe("UsageController (HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(UsageController, [
      { provide: UsageService, useValue: usageService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    usageService.getSummary.mockResolvedValue({
      credits: { balanceCents: 0, priceCentsPer30s: 10, recentTransactions: [] },
      limits: [],
      breakdown: { periodDays: 30, since: "2026-09-24T00:00:00.000Z", items: [] },
      plan: { tier: "free", monthlyAllowanceCents: null },
    });
  });

  it("GET /usage/summary requires JWT auth", async () => {
    await request(app.getHttpServer()).get("/usage/summary").expect(401);
    expect(usageService.getSummary).not.toHaveBeenCalled();
  });

  it("returns the summary for the authenticated user", async () => {
    await request(app.getHttpServer())
      .get("/usage/summary")
      .set("Authorization", `Bearer ${authToken("user-1")}`)
      .expect(200);

    expect(usageService.getSummary).toHaveBeenCalledWith("user-1");
  });

  it("rejects an invalid bearer token with 401", async () => {
    await request(app.getHttpServer())
      .get("/usage/summary")
      .set("Authorization", "Bearer not-a-real-token")
      .expect(401);
    expect(usageService.getSummary).not.toHaveBeenCalled();
  });

  it("scopes the summary to the caller and ignores a client-supplied userId", async () => {
    await request(app.getHttpServer())
      .get("/usage/summary")
      .query({ userId: "user-2" })
      .set("Authorization", `Bearer ${authToken("user-1")}`)
      .expect(200);
    await request(app.getHttpServer())
      .get("/usage/summary")
      .set("Authorization", `Bearer ${authToken("user-2")}`)
      .expect(200);

    expect(usageService.getSummary.mock.calls).toEqual([["user-1"], ["user-2"]]);
  });

  it("returns the service payload with credits, limits and breakdown kept separate", async () => {
    const res = await request(app.getHttpServer())
      .get("/usage/summary")
      .set("Authorization", `Bearer ${authToken("user-1")}`)
      .expect(200);

    expect(Object.keys(res.body).sort()).toEqual([
      "breakdown",
      "credits",
      "limits",
      "plan",
    ]);
  });
});
