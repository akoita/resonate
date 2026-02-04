import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../modules/app.module";
import { INestApplication } from "@nestjs/common";
import { prisma } from "../db/prisma";

describe("Ingestion API metadata", () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.JWT_SECRET = "dev-secret";
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    // Ensure test user and artist exist for background listeners
    await prisma.user.upsert({
      where: { id: "user-1" },
      create: { id: "user-1", email: "user-1@example.com" },
      update: {},
    });
    await prisma.artist.upsert({
      where: { id: "artist-of-user-1" },
      create: {
        id: "artist-of-user-1",
        userId: "user-1",
        displayName: "Aya Lune",
        payoutAddress: "0x1234567890123456789012345678901234567890",
      },
      update: {},
    });
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
      artistId: "artist-of-user-1",
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
      .post("/ingestion/enqueue")
      .set("Authorization", `Bearer ${auth.body.accessToken}`)
      .send(payload)
      .expect(201);

    expect(response.body.trackId).toBeDefined();
    expect(["queued", "complete", "processing"]).toContain(response.body.status);

    // Wait slightly for background events to be processed to avoid FK errors or "Cannot log after tests are done"
    await new Promise((resolve) => setTimeout(resolve, 5000));
  }, 15000);
});
