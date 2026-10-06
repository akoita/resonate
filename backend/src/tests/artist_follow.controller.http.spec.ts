import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { ArtistFollowController } from "../modules/artist_follows/artist_follow.controller";
import { ArtistFollowService } from "../modules/artist_follows/artist_follow.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const followService = {
  getStatus: jest.fn(),
  follow: jest.fn(),
  unfollow: jest.fn(),
};

describe("ArtistFollowController (HTTP contract)", () => {
  let app: INestApplication;
  const bearer = () => `Bearer ${authToken("listener-1")}`;

  beforeAll(async () => {
    app = await createControllerTestApp(ArtistFollowController, [
      { provide: ArtistFollowService, useValue: followService },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.resetAllMocks();
    followService.getStatus.mockResolvedValue({ following: false });
    followService.follow.mockResolvedValue({ following: true });
    followService.unfollow.mockResolvedValue({ following: false });
  });

  it.each([
    ["GET", "get"],
    ["PUT", "put"],
    ["DELETE", "delete"],
  ] as const)("%s /artists/:artistId/follow requires a JWT", async (_label, method) => {
    await request(app.getHttpServer())[method]("/artists/artist-1/follow").expect(401);
    expect(followService.getStatus).not.toHaveBeenCalled();
    expect(followService.follow).not.toHaveBeenCalled();
    expect(followService.unfollow).not.toHaveBeenCalled();
  });

  it("answers the follow status for the authenticated listener only", async () => {
    followService.getStatus.mockResolvedValue({ following: true });
    const response = await request(app.getHttpServer())
      .get("/artists/artist-1/follow")
      .query({ userId: "someone-else" })
      .set("Authorization", bearer())
      .expect(200);
    expect(response.body).toEqual({ following: true });
    expect(followService.getStatus).toHaveBeenCalledWith("listener-1", "artist-1");
  });

  it("follows without a body", async () => {
    const response = await request(app.getHttpServer())
      .put("/artists/artist-1/follow")
      .set("Authorization", bearer())
      .expect(200);
    expect(response.body).toEqual({ following: true });
    expect(followService.follow).toHaveBeenCalledWith("listener-1", "artist-1", expect.any(Object));
  });

  it("passes the optional release context and user-declared city through", async () => {
    const body = {
      releaseId: "release-1",
      trackId: "track-1",
      source: "release_page",
      geo: { countryCode: "CA", citySlug: "montreal", source: "user_declared", precision: "city" },
    };
    await request(app.getHttpServer())
      .put("/artists/artist-1/follow")
      .set("Authorization", bearer())
      .send(body)
      .expect(200);
    expect(followService.follow).toHaveBeenCalledWith("listener-1", "artist-1", body);
  });

  it.each([
    ["a non-string releaseId", { releaseId: 12 }],
    ["a releaseId with prose", { releaseId: "not an id!" }],
    ["a trackId that is too long", { trackId: "t".repeat(129) }],
    ["a source with prose", { source: "Release Page " }],
    ["an overlong source", { source: "a".repeat(65) }],
    ["geo that is not an object", { geo: "montreal" }],
  ])("rejects %s with 400", async (_label, body) => {
    await request(app.getHttpServer())
      .put("/artists/artist-1/follow")
      .set("Authorization", bearer())
      .send(body)
      .expect(400);
    expect(followService.follow).not.toHaveBeenCalled();
  });

  it("unfollows idempotently for the authenticated listener", async () => {
    const response = await request(app.getHttpServer())
      .delete("/artists/artist-1/follow")
      .set("Authorization", bearer())
      .expect(200);
    expect(response.body).toEqual({ following: false });
    expect(followService.unfollow).toHaveBeenCalledWith("listener-1", "artist-1");
  });

  it("exposes no follower list or count route", async () => {
    for (const path of ["/artists/artist-1/followers", "/artists/artist-1/follow/count"]) {
      await request(app.getHttpServer()).get(path).set("Authorization", bearer()).expect(404);
    }
  });
});
