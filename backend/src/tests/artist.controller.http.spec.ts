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
  findById: jest.fn().mockResolvedValue({ id: "artist-1", remixConsent: "allowed" }),
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
});
