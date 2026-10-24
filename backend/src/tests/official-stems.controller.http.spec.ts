/**
 * Official stems upload route (#1976) — HTTP contract: auth, the multipart
 * field names that carry the stem type, and how the service's refusals reach
 * the client (403 off the rights route, 400 with a readable reason).
 */
import request from "supertest";
import { BadRequestException, ForbiddenException, INestApplication } from "@nestjs/common";
import { OfficialStemsController } from "../modules/ingestion/official-stems.controller";
import { OfficialStemsService } from "../modules/ingestion/official-stems.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";
import { wavBuffer, syntheticStems } from "./official_stems_fixtures";

const service = { uploadPackage: jest.fn() };
const URL = "/ingestion/releases/rel-1/tracks/trk-1/official-stems";

describe("POST /ingestion/releases/:releaseId/tracks/:trackId/official-stems", () => {
  let app: INestApplication;
  const wav = wavBuffer(syntheticStems(1).drums);

  beforeAll(async () => {
    app = await createControllerTestApp(OfficialStemsController, [
      { provide: OfficialStemsService, useValue: service },
    ]);
  });
  afterAll(async () => {
    await app.close();
  });
  beforeEach(() => {
    jest.clearAllMocks();
    service.uploadPackage.mockResolvedValue({ releaseId: "rel-1", trackId: "trk-1", stems: [], replaced: 0, summedLevel: null });
  });

  it("answers 401 without a JWT", async () => {
    await request(app.getHttpServer()).post(URL).attach("drums", wav, "drums.wav").expect(401);
    expect(service.uploadPackage).not.toHaveBeenCalled();
  });

  it("answers 400 when no stem file is sent", async () => {
    const res = await request(app.getHttpServer())
      .post(URL)
      .set("Authorization", `Bearer ${authToken("artist-user")}`)
      .set("Content-Type", "multipart/form-data; boundary=x")
      .send("--x--\r\n")
      .expect(400);
    expect(res.body.code).toBe("official_stems_rejected");
    expect(service.uploadPackage).not.toHaveBeenCalled();
  });

  it("answers 400 for a field that is not a stem type, so the type is never guessed from a file name", async () => {
    await request(app.getHttpServer())
      .post(URL)
      .set("Authorization", `Bearer ${authToken("artist-user")}`)
      .attach("synth", wav, "drums.wav")
      .expect(400);
    expect(service.uploadPackage).not.toHaveBeenCalled();
  });

  it("hands each file to the service under the stem type of its field", async () => {
    await request(app.getHttpServer())
      .post(URL)
      .set("Authorization", `Bearer ${authToken("artist-user")}`)
      .attach("drums", wav, "anything.wav")
      .attach("bass", wav, "x.wav")
      .expect(201);
    expect(service.uploadPackage).toHaveBeenCalledTimes(1);
    const call = service.uploadPackage.mock.calls[0][0];
    expect(call).toEqual(
      expect.objectContaining({ releaseId: "rel-1", trackId: "trk-1", userId: "artist-user" }),
    );
    const sent = Object.keys(call.files).filter((type) => call.files[type]);
    expect(sent.sort()).toEqual(["bass", "drums"]);
    expect(call.files.drums.originalname).toBe("anything.wav");
  });

  it("answers 403 when the account is off the release's rights route", async () => {
    service.uploadPackage.mockRejectedValueOnce(
      new ForbiddenException({ code: "official_stems_forbidden", message: "Only an account that manages this release can upload its official stems" }),
    );
    const res = await request(app.getHttpServer())
      .post(URL)
      .set("Authorization", `Bearer ${authToken("someone-else")}`)
      .attach("drums", wav, "drums.wav")
      .expect(403);
    expect(res.body.code).toBe("official_stems_forbidden");
  });

  it("answers 400 with the readable reasons when the package fails the checks", async () => {
    service.uploadPackage.mockRejectedValueOnce(
      new BadRequestException({
        code: "official_stems_rejected",
        message: "The drums (drums.wav) file is 203.0 s long but the published mix is 200.0 s",
        issues: [{ code: "duration_mismatch", stemType: "drums", message: "The drums (drums.wav) file is 203.0 s long" }],
      }),
    );
    const res = await request(app.getHttpServer())
      .post(URL)
      .set("Authorization", `Bearer ${authToken("artist-user")}`)
      .attach("drums", wav, "drums.wav")
      .expect(400);
    expect(res.body.issues[0].code).toBe("duration_mismatch");
    expect(res.body.message).toContain("203.0 s");
  });
});
