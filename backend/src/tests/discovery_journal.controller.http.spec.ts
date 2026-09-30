import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { DiscoveryJournalController } from "../modules/discovery_journal/discovery_journal.controller";
import { DiscoveryJournalService } from "../modules/discovery_journal/discovery_journal.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

describe("DiscoveryJournalController (HTTP)", () => {
  let app: INestApplication;
  const getJournal = jest.fn();

  beforeAll(async () => {
    app = await createControllerTestApp(DiscoveryJournalController, [
      { provide: DiscoveryJournalService, useValue: { getJournal } },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getJournal.mockReset();
    getJournal.mockResolvedValue({ schemaVersion: "discovery-journal/v1", groups: [] });
  });

  it("rejects requests without a JWT", async () => {
    await request(app.getHttpServer()).get("/agents/discoveries").expect(401);
    expect(getJournal).not.toHaveBeenCalled();
  });

  it("reads only the JWT user and applies the defaults", async () => {
    const res = await request(app.getHttpServer())
      .get("/agents/discoveries")
      .set("Authorization", `Bearer ${authToken("listener-1")}`)
      .expect(200);

    expect(res.body).toEqual({ schemaVersion: "discovery-journal/v1", groups: [] });
    expect(getJournal).toHaveBeenCalledTimes(1);
    expect(getJournal).toHaveBeenCalledWith("listener-1", { windowDays: 28, limit: 50 });
  });

  it("ignores any userId supplied by the caller", async () => {
    await request(app.getHttpServer())
      .get("/agents/discoveries?userId=someone-else")
      .set("Authorization", `Bearer ${authToken("listener-1")}`)
      .expect(200);

    expect(getJournal.mock.calls[0][0]).toBe("listener-1");
  });

  it("clamps windowDays to 1..90 and limit to 1..100", async () => {
    const auth = `Bearer ${authToken("listener-1")}`;
    await request(app.getHttpServer())
      .get("/agents/discoveries?windowDays=500&limit=9999")
      .set("Authorization", auth)
      .expect(200);
    await request(app.getHttpServer())
      .get("/agents/discoveries?windowDays=0&limit=-5")
      .set("Authorization", auth)
      .expect(200);
    await request(app.getHttpServer())
      .get("/agents/discoveries?windowDays=14&limit=20")
      .set("Authorization", auth)
      .expect(200);

    expect(getJournal.mock.calls.map((call) => call[1])).toEqual([
      { windowDays: 90, limit: 100 },
      { windowDays: 1, limit: 1 },
      { windowDays: 14, limit: 20 },
    ]);
  });

  it("rejects non-integer params with 400", async () => {
    const auth = `Bearer ${authToken("listener-1")}`;
    await request(app.getHttpServer())
      .get("/agents/discoveries?windowDays=abc")
      .set("Authorization", auth)
      .expect(400);
    await request(app.getHttpServer())
      .get("/agents/discoveries?limit=1.5")
      .set("Authorization", auth)
      .expect(400);
    expect(getJournal).not.toHaveBeenCalled();
  });
});
