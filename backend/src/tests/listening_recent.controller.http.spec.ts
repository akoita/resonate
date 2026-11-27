import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ListeningRecentController } from "../modules/listening_stats/listening_recent.controller";
import { ListeningRecentService } from "../modules/listening_stats/listening_recent.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

describe("ListeningRecentController (HTTP)", () => {
  let app: INestApplication;
  const getRecent = jest.fn();

  beforeAll(async () => {
    app = await createControllerTestApp(ListeningRecentController, [
      { provide: ListeningRecentService, useValue: { getRecent } },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getRecent.mockReset();
    getRecent.mockResolvedValue({ schemaVersion: "listening-recent/v1", recording: true, items: [] });
  });

  const auth = () => `Bearer ${authToken("listener-1")}`;

  it("rejects requests without a JWT", async () => {
    await request(app.getHttpServer()).get("/listening/recent").expect(401);
    expect(getRecent).not.toHaveBeenCalled();
  });

  it("reads only the JWT user and applies the default limit", async () => {
    await request(app.getHttpServer())
      .get("/listening/recent?userId=someone-else")
      .set("Authorization", auth())
      .expect(200);
    expect(getRecent).toHaveBeenCalledWith("listener-1", { limit: 12 });
  });

  it("accepts a limit within range", async () => {
    await request(app.getHttpServer()).get("/listening/recent?limit=8").set("Authorization", auth()).expect(200);
    expect(getRecent).toHaveBeenCalledWith("listener-1", { limit: 8 });
  });

  it.each(["0", "25", "abc", "-1", "1.5"])("rejects limit=%s", async (limit) => {
    await request(app.getHttpServer())
      .get(`/listening/recent?limit=${limit}`)
      .set("Authorization", auth())
      .expect(400);
    expect(getRecent).not.toHaveBeenCalled();
  });
});
