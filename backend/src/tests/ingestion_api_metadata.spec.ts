import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../modules/app.module";
import { INestApplication } from "@nestjs/common";

describe("Ingestion API metadata", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = "dev-secret";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("accepts metadata in upload payload", async () => {
    const auth = await request(app.getHttpServer())
      .post("/auth/login")
      .send({ userId: "user-1" })
      .expect(201);

    const payload = {
      artistId: "artist-1",
      fileUris: ["gs://bucket/audio.wav"],
      metadata: {
        releaseType: "single",
        releaseTitle: "Night Drive",
        primaryArtist: "Aya Lune",
        featuredArtists: ["Kiro"],
        genre: "Electronic",
        isrc: "US-XYZ-24-00001",
        label: "Resonate Records",
        releaseDate: "2026-01-18",
        explicit: true,
      },
    };

    const response = await request(app.getHttpServer())
      .post("/stems/upload")
      .set("Authorization", `Bearer ${auth.body.accessToken}`)
      .send(payload)
      .expect(201);

    expect(response.body.trackId).toBeDefined();
    expect(response.body.status).toBe("queued");
  });
});
