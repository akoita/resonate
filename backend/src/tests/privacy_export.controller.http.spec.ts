import { INestApplication, NotFoundException } from "@nestjs/common";
import { THROTTLER_TRACKER, THROTTLER_TTL } from "@nestjs/throttler/dist/throttler.constants";
import request from "supertest";
import { PersonalDataExportService } from "../modules/privacy/personal_data_export.service";
import { PrivacyController } from "../modules/privacy/privacy.controller";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const exportService = {
  prepare: jest.fn(),
};

function preparedFor(userId: string) {
  return {
    subject: {
      userId,
      email: `${userId}@test.resonate`,
      walletAddresses: [],
      ownerAddresses: [],
      artistIds: [],
      analyticsActorId: null,
    },
    writeTo: jest.fn(async (out: NodeJS.WritableStream) => {
      out.write(`{"subjectUserId":${JSON.stringify(userId)},"complete":true}`);
    }),
  };
}

describe("Privacy personal data export (HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(PrivacyController, [
      { provide: PersonalDataExportService, useValue: exportService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    exportService.prepare.mockImplementation(async (userId: string) => preparedFor(userId));
  });

  it("rejects an unauthenticated request and reads nothing", async () => {
    await request(app.getHttpServer()).get("/privacy/export").expect(401);
    expect(exportService.prepare).not.toHaveBeenCalled();
  });

  it("rejects a request whose bearer token is not ours", async () => {
    await request(app.getHttpServer())
      .get("/privacy/export")
      .set("Authorization", "Bearer not-a-real-token")
      .expect(401);
    expect(exportService.prepare).not.toHaveBeenCalled();
  });

  it("exports only the authenticated user, ignoring a user id in the query string", async () => {
    const response = await request(app.getHttpServer())
      .get("/privacy/export?userId=victim-1&user_id=victim-1&subject=victim-1")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(200);

    // The whole point: one call, for the token's subject, never for the id the
    // caller asked for.
    expect(exportService.prepare).toHaveBeenCalledTimes(1);
    expect(exportService.prepare).toHaveBeenCalledWith("listener-1");
    expect(response.text).toContain('"subjectUserId":"listener-1"');
    expect(response.text).not.toContain("victim-1");
  });

  it("exports only the authenticated user, ignoring a user id in the body", async () => {
    await request(app.getHttpServer())
      .get("/privacy/export")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .send({ userId: "victim-1" })
      .expect(200);

    expect(exportService.prepare).toHaveBeenCalledWith("listener-1");
  });

  it("has no route that takes a user id as a path parameter", async () => {
    await request(app.getHttpServer())
      .get("/privacy/export/victim-1")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(404);
    expect(exportService.prepare).not.toHaveBeenCalled();
  });

  it("sends an attachment named by date only, and forbids caching", async () => {
    const response = await request(app.getHttpServer())
      .get("/privacy/export")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(200);

    expect(response.headers["content-type"]).toBe("application/json; charset=utf-8");
    expect(response.headers["cache-control"]).toBe("no-store");

    const disposition = response.headers["content-disposition"];
    expect(disposition).toMatch(
      /^attachment; filename="resonate-data-export-\d{4}-\d{2}-\d{2}\.json"$/,
    );
    // A downloads folder, a shell history and a sync client all see this name.
    expect(disposition).not.toContain("listener-1");
    expect(disposition).not.toContain("@test.resonate");
  });

  it("surfaces an unknown user as a status code, because nothing has been streamed yet", async () => {
    exportService.prepare.mockRejectedValueOnce(new NotFoundException("User ghost not found"));

    await request(app.getHttpServer())
      .get("/privacy/export")
      .set("Authorization", `Bearer ${authToken("ghost", "listener")}`)
      .expect(404);
  });

  it("counts the rate limit against the person, not the address they happen to browse from", () => {
    // The default tracker is `req.ip`, which is wrong both ways here: a
    // household behind one NAT would share one account's budget, and a stolen
    // token would get an unlimited number of dossiers by changing IP. This
    // asserts the route overrides it, because the override is invisible at the
    // call site and a later edit would not notice removing it.
    const handler = PrivacyController.prototype.exportPersonalData;
    const getTracker = Reflect.getMetadata(`${THROTTLER_TRACKER}default`, handler);
    expect(typeof getTracker).toBe("function");
    expect(getTracker({ user: { userId: "person-a" }, ip: "203.0.113.9" })).toBe("person-a");
    expect(getTracker({ ip: "203.0.113.9" })).toBe("203.0.113.9");

    // Milliseconds, not seconds — see the handler. Asserted so the window
    // cannot be "corrected" back to 3600 (three per 3.6 seconds) when #1790
    // sweeps the rest of the codebase.
    expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(3_600_000);
  });

  it("streams the document through the service rather than buffering it in the controller", async () => {
    const prepared = preparedFor("listener-1");
    exportService.prepare.mockResolvedValueOnce(prepared);

    await request(app.getHttpServer())
      .get("/privacy/export")
      .set("Authorization", `Bearer ${authToken("listener-1", "listener")}`)
      .expect(200);

    expect(prepared.writeTo).toHaveBeenCalledTimes(1);
    // The controller hands the live response to the service; it never sees rows.
    expect(prepared.writeTo.mock.calls[0][0]).toBeDefined();
  });
});
