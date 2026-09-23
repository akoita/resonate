/**
 * ArtistController — HTTP Contract Test
 *
 * Covers auth guard behavior and the artist settings ownership boundary.
 */

import request from "supertest";
import { ForbiddenException, INestApplication, NotFoundException } from "@nestjs/common";
import { ArtistController } from "../modules/artist/artist.controller";
import { ArtistService } from "../modules/artist/artist.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockArtistService = {
  getProfile: jest.fn().mockResolvedValue({ id: "artist-1", remixConsent: "allowed" }),
  findById: jest.fn().mockResolvedValue({
    id: "artist-1",
    displayName: "Bouba",
    profileType: "public_artist",
    claimStatus: "unclaimed",
    imageUrl: null,
    summary: null,
    socialLinks: null,
    website: null,
    remixConsent: "allowed",
    createdAt: new Date("2026-06-11T19:30:00.000Z"),
    updatedAt: new Date("2026-06-11T19:30:00.000Z"),
    userId: "private-user-id",
    payoutAddress: "0xprivate",
    claimRequests: [{ evidence: "private claim evidence" }],
  }),
  createProfile: jest.fn().mockResolvedValue({ id: "artist-1" }),
  getSettings: jest.fn().mockResolvedValue({
    schemaVersion: "artist-settings/v1",
    artistId: "artist-1",
    remixConsent: "allowed",
    updatedAt: "2026-06-11T19:30:00.000Z",
  }),
  updateSettings: jest.fn().mockResolvedValue({
    schemaVersion: "artist-settings/v1",
    artistId: "artist-1",
    remixConsent: "disabled",
    updatedAt: "2026-06-11T19:31:00.000Z",
  }),
  searchByName: jest.fn().mockResolvedValue([
    { id: "artist-1", displayName: "Bouba", imageUrl: null, profileType: "manager", claimStatus: "claimed" },
  ]),
  getMyClaims: jest.fn().mockResolvedValue([
    {
      status: "pending",
      createdAt: new Date("2026-06-11T19:30:00.000Z"),
      updatedAt: new Date("2026-06-11T19:30:00.000Z"),
      reviewedAt: null,
      artist: { id: "artist-1", displayName: "Bouba", imageUrl: null },
    },
  ]),
  submitClaim: jest.fn().mockResolvedValue({ id: "claim-1", artistId: "artist-1", status: "pending" }),
  getMyClaim: jest.fn().mockResolvedValue({ id: "claim-1", artistId: "artist-1", status: "pending" }),
  listPendingClaims: jest.fn().mockResolvedValue([
    { id: "claim-1", artistId: "artist-1", evidence: "private evidence", status: "pending" },
  ]),
  reviewClaim: jest.fn().mockResolvedValue({ id: "claim-1", status: "approved" }),
};

describe("ArtistController (e2e)", () => {
  let app: INestApplication;
  const token = authToken("user-1");

  beforeAll(async () => {
    app = await createControllerTestApp(ArtistController, [
      { provide: ArtistService, useValue: mockArtistService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  it("GET /artists/:id/settings -> 401 without JWT", async () => {
    await request(app.getHttpServer()).get("/artists/artist-1/settings").expect(401);
  });

  it("GET /artists/:id/settings -> 200 and resolves ownership from JWT user", async () => {
    const res = await request(app.getHttpServer())
      .get("/artists/artist-1/settings")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body.remixConsent).toBe("allowed");
    expect(mockArtistService.getSettings).toHaveBeenCalledWith("user-1", "artist-1");
  });

  it("PATCH /artists/:id/settings -> 200 and ignores client-submitted artistId", async () => {
    await request(app.getHttpServer())
      .patch("/artists/artist-1/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ artistId: "attacker-artist", remixConsent: "disabled" })
      .expect(200);

    expect(mockArtistService.updateSettings).toHaveBeenCalledWith(
      "user-1",
      "artist-1",
      expect.objectContaining({ remixConsent: "disabled" }),
    );
  });

  it("PATCH /artists/:id/settings -> 403 for non-owned route artist", async () => {
    mockArtistService.updateSettings.mockRejectedValueOnce(new ForbiddenException("You do not manage this artist profile"));

    await request(app.getHttpServer())
      .patch("/artists/other-artist/settings")
      .set("Authorization", `Bearer ${token}`)
      .send({ artistId: "artist-1", remixConsent: "disabled" })
      .expect(403);
  });

  it("GET /artists/:id/settings -> 404 when the caller has no artist profile", async () => {
    mockArtistService.getSettings.mockRejectedValueOnce(new NotFoundException("Artist profile not found"));

    await request(app.getHttpServer())
      .get("/artists/missing/settings")
      .set("Authorization", `Bearer ${authToken("user-without-artist")}`)
      .expect(404);
  });

  it("GET /artists/search -> 401 without JWT", async () => {
    await request(app.getHttpServer()).get("/artists/search?q=bou").expect(401);
  });

  it("GET /artists/search -> 200, matched as a literal route (not :id) and forwards q + limit", async () => {
    const res = await request(app.getHttpServer())
      .get("/artists/search?q=bou&limit=5")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body[0].displayName).toBe("Bouba");
    expect(res.body[0].claimStatus).toBe("claimed");
    // "search" must hit searchByName, never the :id getById handler.
    expect(mockArtistService.searchByName).toHaveBeenCalledWith("bou", 5);
    expect(mockArtistService.findById).not.toHaveBeenCalled();
  });

  it("GET /artists/search -> defaults the limit when omitted/non-numeric", async () => {
    await request(app.getHttpServer())
      .get("/artists/search?q=bou")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    // undefined limit lets the service default apply.
    expect(mockArtistService.searchByName).toHaveBeenCalledWith("bou", undefined);
  });

  it("POST /artists/:id/claims -> 401 without JWT", async () => {
    await request(app.getHttpServer())
      .post("/artists/artist-1/claims")
      .send({ evidence: "A sufficiently detailed claim statement." })
      .expect(401);
  });

  it("GET /artists/claims/me -> requires JWT and returns the caller's latest claim summaries", async () => {
    await request(app.getHttpServer()).get("/artists/claims/me").expect(401);

    const res = await request(app.getHttpServer())
      .get("/artists/claims/me?userId=attacker")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(res.body).toEqual([
      {
        status: "pending",
        createdAt: "2026-06-11T19:30:00.000Z",
        updatedAt: "2026-06-11T19:30:00.000Z",
        reviewedAt: null,
        artist: { id: "artist-1", displayName: "Bouba", imageUrl: null },
      },
    ]);
    expect(res.body[0]).not.toHaveProperty("evidence");
    expect(res.body[0]).not.toHaveProperty("claimantUserId");
    expect(res.body[0]).not.toHaveProperty("reviewerUserId");
    expect(res.body[0]).not.toHaveProperty("reviewNote");
    expect(mockArtistService.getMyClaims).toHaveBeenCalledWith("user-1");
    // The literal collection route must not be captured by GET /:id.
    expect(mockArtistService.findById).not.toHaveBeenCalled();
  });

  it("POST /artists/:id/claims -> derives claimant identity from JWT", async () => {
    await request(app.getHttpServer())
      .post("/artists/artist-1/claims")
      .set("Authorization", `Bearer ${token}`)
      .send({ claimantUserId: "attacker", evidence: "A sufficiently detailed claim statement." })
      .expect(201);

    expect(mockArtistService.submitClaim).toHaveBeenCalledWith(
      "user-1",
      "artist-1",
      "A sufficiently detailed claim statement.",
    );
  });

  it("GET /artists/:id/claims/me -> returns only the caller's claim summary", async () => {
    await request(app.getHttpServer())
      .get("/artists/artist-1/claims/me")
      .set("Authorization", `Bearer ${token}`)
      .expect(200);

    expect(mockArtistService.getMyClaim).toHaveBeenCalledWith("user-1", "artist-1");
  });

  it("GET /artists/claims/pending -> requires an operator or admin role", async () => {
    await request(app.getHttpServer()).get("/artists/claims/pending").expect(401);
    await request(app.getHttpServer())
      .get("/artists/claims/pending")
      .set("Authorization", `Bearer ${token}`)
      .expect(403);

    const res = await request(app.getHttpServer())
      .get("/artists/claims/pending")
      .set("Authorization", `Bearer ${authToken("operator-1", "operator")}`)
      .expect(200);

    expect(res.body[0].evidence).toBe("private evidence");
    expect(mockArtistService.listPendingClaims).toHaveBeenCalledWith("operator");
  });

  it("PATCH /artists/claims/:claimId -> requires operator role and takes reviewer identity from JWT", async () => {
    await request(app.getHttpServer())
      .patch("/artists/claims/claim-1")
      .set("Authorization", `Bearer ${token}`)
      .send({ decision: "approve" })
      .expect(403);

    await request(app.getHttpServer())
      .patch("/artists/claims/claim-1")
      .set("Authorization", `Bearer ${authToken("admin-1", "admin")}`)
      .send({ reviewerUserId: "attacker", decision: "reject", note: "Reviewed." })
      .expect(200);

    expect(mockArtistService.reviewClaim).toHaveBeenCalledWith(
      "admin-1",
      "admin",
      "claim-1",
      "reject",
      "Reviewed.",
    );
  });

  it("GET /artists/:id -> returns a public DTO without manager or claim-private fields", async () => {
    const res = await request(app.getHttpServer())
      .get("/artists/artist-1")
      .expect(200);

    expect(res.body).toMatchObject({ id: "artist-1", displayName: "Bouba" });
    expect(res.body).not.toHaveProperty("userId");
    expect(res.body).not.toHaveProperty("payoutAddress");
    expect(res.body).not.toHaveProperty("claimRequests");
    expect(res.body).not.toHaveProperty("claimStatus");
  });
});
