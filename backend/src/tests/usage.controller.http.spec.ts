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
});
