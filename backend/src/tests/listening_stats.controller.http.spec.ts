import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ListeningStatsController } from "../modules/listening_stats/listening_stats.controller";
import { ListeningStatsService } from "../modules/listening_stats/listening_stats.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

describe("ListeningStatsController (HTTP)", () => {
  let app: INestApplication;
  const getStats = jest.fn();

  beforeAll(async () => {
    app = await createControllerTestApp(ListeningStatsController, [
      { provide: ListeningStatsService, useValue: { getStats } },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getStats.mockReset();
    getStats.mockResolvedValue({ schemaVersion: "listening-stats/v1" });
  });

  const auth = () => `Bearer ${authToken("listener-1")}`;

  it("rejects requests without a JWT", async () => {
    await request(app.getHttpServer()).get("/listening/stats").expect(401);
    expect(getStats).not.toHaveBeenCalled();
  });

  it("reads only the JWT user and applies the defaults", async () => {
    await request(app.getHttpServer())
      .get("/listening/stats?userId=someone-else")
      .set("Authorization", auth())
      .expect(200);
    expect(getStats).toHaveBeenCalledWith("listener-1", { windowDays: 30 });
  });

  it("accepts the offered windows", async () => {
    await request(app.getHttpServer()).get("/listening/stats?days=365").set("Authorization", auth()).expect(200);
    expect(getStats).toHaveBeenCalledWith("listener-1", { windowDays: 365 });
  });

  it.each(["days=14", "days=abc", "days=-7", "days=7.5"])("refuses %s", async (query) => {
    await request(app.getHttpServer())
      .get(`/listening/stats?${query}`)
      .set("Authorization", auth())
      .expect(400);
    expect(getStats).not.toHaveBeenCalled();
  });
});
