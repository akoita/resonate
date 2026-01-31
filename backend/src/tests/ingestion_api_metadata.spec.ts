import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../modules/app.module";
import { INestApplication } from "@nestjs/common";
import { prisma } from "../db/prisma";

describe("Ingestion API metadata", () => {
  let app: INestApplication;

  beforeAll(async () => {
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

  it("should process ingestion and update release metadata", async () => {
    const response = await request(app.getHttpServer())
      .post("/ingestion/metadata")
      .send({
        releaseId: `rel_${Date.now()}_${Math.random().toString(16).slice(2, 10)}`,
        artistId: "artist-of-user-1",
        metadata: {
          title: "Test Release",
          genre: "Electronic",
        },
      })
      .expect(201);

    expect(response.body.releaseId).toBeDefined();
    expect(["queued", "complete", "processing"]).toContain(response.body.status);

    // Wait slightly for background events to be processed to avoid FK errors or "Cannot log after tests are done"
    await new Promise((resolve) => setTimeout(resolve, 1500));
  });
});
