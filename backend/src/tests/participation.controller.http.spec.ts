/**
 * Participation routes (#2666): who may call them, body validation, and the
 * admin audit record.
 */
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { RolesGuard } from "../modules/auth/roles.guard";
import { ParticipationController } from "../modules/participation/participation.controller";
import { ParticipationService } from "../modules/participation/participation.service";
import { writeAdminAuditEvent } from "../modules/admin_audit/admin_audit_event";
import { authToken, createControllerTestApp } from "./e2e-helpers";

jest.mock("../modules/admin_audit/admin_audit_event", () => ({
  ...jest.requireActual("../modules/admin_audit/admin_audit_event"),
  writeAdminAuditEvent: jest.fn().mockResolvedValue(undefined),
}));
const mockAudit = writeAdminAuditEvent as jest.Mock;

const HASH = "a".repeat(64);
const CHOICES = { remixConsent: "allowed", aiRemixApproval: "required", aiSourceUse: "disabled", stemListing: "disabled" };

const service = {
  agreement: jest.fn().mockReturnValue({ version: "v1", text: "# Agreement", textHash: HASH, placeholder: false, available: true }),
  status: jest.fn().mockResolvedValue({ artistId: "artist-1", needsAcceptance: true }),
  accept: jest.fn().mockResolvedValue({ artistId: "artist-1", needsAcceptance: false }),
  updateChoices: jest.fn().mockResolvedValue({ artistId: "artist-1", needsAcceptance: false }),
  describeForOperator: jest.fn().mockResolvedValue({ artistId: "artist-1" }),
};

describe("Participation routes (http)", () => {
  let app: INestApplication;
  const artist = `Bearer ${authToken("user-1", "artist")}`;
  const operator = `Bearer ${authToken("op-1", "operator")}`;

  beforeAll(async () => {
    app = await createControllerTestApp([ParticipationController], [
      { provide: ParticipationService, useValue: service },
      RolesGuard,
    ]);
  });
  afterAll(async () => app.close());
  beforeEach(() => jest.clearAllMocks());

  it("serves the agreement to anyone", async () => {
    await request(app.getHttpServer()).get("/participation/agreement").expect(200).expect((res) => {
      expect(res.body).toEqual(expect.objectContaining({ version: "v1", textHash: HASH }));
    });
  });

  it("needs a signed-in account for the artist routes", async () => {
    await request(app.getHttpServer()).get("/artists/artist-1/participation").expect(401);
    await request(app.getHttpServer()).post("/artists/artist-1/participation/accept").send({}).expect(401);
  });

  it("accepts a complete body and refuses a malformed one", async () => {
    await request(app.getHttpServer())
      .post("/artists/artist-1/participation/accept")
      .set("Authorization", artist)
      .send({ version: "v1", textHash: HASH, choices: CHOICES })
      .expect(201);
    expect(service.accept).toHaveBeenCalledWith("user-1", "artist-1", expect.objectContaining({ version: "v1" }));

    await request(app.getHttpServer())
      .post("/artists/artist-1/participation/accept")
      .set("Authorization", artist)
      .send({ version: "v1", textHash: "short", choices: CHOICES })
      .expect(400);
    await request(app.getHttpServer())
      .post("/artists/artist-1/participation/accept")
      .set("Authorization", artist)
      .send({ version: "v1", textHash: HASH, choices: { ...CHOICES, stemListing: "sometimes" } })
      .expect(400);
  });

  it("validates a change of choices", async () => {
    await request(app.getHttpServer())
      .patch("/artists/artist-1/participation/choices")
      .set("Authorization", artist)
      .send({ aiSourceUse: "allowed" })
      .expect(200);
    await request(app.getHttpServer())
      .patch("/artists/artist-1/participation/choices")
      .set("Authorization", artist)
      .send({ aiSourceUse: "maybe" })
      .expect(400);
  });

  it("shows the record to operators only, and audits it", async () => {
    await request(app.getHttpServer()).get("/admin/artists/artist-1/participation").set("Authorization", artist).expect(403);
    await request(app.getHttpServer()).get("/admin/artists/artist-1/participation").set("Authorization", operator).expect(200);
    expect(mockAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "artist_participation.viewed" }),
    );
  });
});
