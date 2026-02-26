import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../modules/app.module";
import { INestApplication } from "@nestjs/common";
import { prisma } from "../db/prisma";

describe("Asset Persistence", () => {
    let app: INestApplication;

    beforeAll(async () => {
        process.env.JWT_SECRET = "dev-secret";
        const moduleRef = await Test.createTestingModule({
            imports: [AppModule],
        }).compile();
        app = moduleRef.createNestApplication();
        await app.init();
    }, 30000);

    afterAll(async () => {
        await app.close();
    });

    it("persists stem data and artwork to the database", async () => {
        // 1. Create a user and artist
        const user = await prisma.user.create({
            data: { email: `test-${Date.now()}@example.com` }
        });
        const artist = await prisma.artist.create({
            data: { userId: user.id, displayName: "Test Artist", payoutAddress: "0x123" }
        });

        // 2. Login
        const auth = await request(app.getHttpServer())
            .post("/auth/login")
            .send({ userId: user.id })
            .expect(201);

        // 3. Upload with "files" and "artwork"
        // Use supertest to send multipart/form-data
        const audioBuffer = Buffer.from("fake audio data");
        const imageBuffer = Buffer.from("fake image data");

        const response = await request(app.getHttpServer())
            .post("/ingestion/upload")
            .set("Authorization", `Bearer ${auth.body.accessToken}`)
            .attach("files", audioBuffer, "test.mp3")
            .attach("artwork", imageBuffer, "cover.jpg")
            .field("artistId", artist.id)
            .field("metadata", JSON.stringify({ title: "Test Release" }))
            .expect(201);

        const releaseId = response.body.releaseId;
        expect(releaseId).toBeDefined();
        console.log(`[Test] Release created: ${releaseId}`);

        // 4. Wait for processing (IngestionService has a 1s delay + CatalogService has 1s retry)
        await new Promise(resolve => setTimeout(resolve, 5000));

        // 5. Verify database records
        const release = await prisma.release.findUnique({
            where: { id: releaseId },
            include: { tracks: { include: { stems: true } } }
        });

        if (!release) {
            console.error(`[Test] Release ${releaseId} not found in DB!`);
        }

        expect(release).toBeTruthy();
        expect(release?.artworkData).toBeTruthy();
        expect(release?.artworkData?.toString()).toBe("fake image data");
        expect(release?.status).toBe("ready");

        const track = release?.tracks[0];
        expect(track).toBeDefined();
        const stem = track?.stems[0];
        expect(stem).toBeDefined();
        expect(stem?.data).toBeDefined();
        expect(stem?.data?.toString()).toBe("fake audio data");
    }, 15000);
});
