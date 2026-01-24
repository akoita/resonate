"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const testing_1 = require("@nestjs/testing");
const supertest_1 = __importDefault(require("supertest"));
const app_module_1 = require("../modules/app.module");
describe("Ingestion API metadata", () => {
    let app;
    beforeAll(async () => {
        process.env.JWT_SECRET = "dev-secret";
        const moduleRef = await testing_1.Test.createTestingModule({
            imports: [app_module_1.AppModule],
        }).compile();
        app = moduleRef.createNestApplication();
        await app.init();
    });
    afterAll(async () => {
        await app.close();
    });
    it("accepts metadata in upload payload", async () => {
        const auth = await (0, supertest_1.default)(app.getHttpServer())
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
        const response = await (0, supertest_1.default)(app.getHttpServer())
            .post("/stems/upload")
            .set("Authorization", `Bearer ${auth.body.accessToken}`)
            .send(payload)
            .expect(201);
        expect(response.body.trackId).toBeDefined();
        expect(["queued", "complete"]).toContain(response.body.status);
    });
});
