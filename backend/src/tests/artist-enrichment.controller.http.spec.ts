import { ForbiddenException, INestApplication } from "@nestjs/common";
import {
    THROTTLER_LIMIT,
    THROTTLER_TTL,
    THROTTLER_TRACKER,
} from "@nestjs/throttler/dist/throttler.constants";
import request from "supertest";
import { ArtistController } from "../modules/artist/artist.controller";
import { ArtistEnrichmentService } from "../modules/artist/artist-enrichment.service";
import { ArtistService } from "../modules/artist/artist.service";
import { hours } from "../modules/shared/rate_limits";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockArtistService = {
    authorizeProfileEdit: jest.fn().mockResolvedValue({ id: "artist-1", displayName: "Ada Example" }),
};

const mockEnrichmentService = {
    findCandidates: jest.fn().mockResolvedValue([
        {
            id: "12345678-1234-4234-8234-123456789abc",
            name: "Ada Example",
            disambiguation: null,
            area: "France",
            type: "Person",
            score: 100,
            sourceUrl: "https://musicbrainz.org/artist/12345678-1234-4234-8234-123456789abc",
        },
    ]),
    buildSuggestions: jest.fn().mockResolvedValue({ candidate: { id: "artist-mbid", name: "Ada Example" }, suggestions: [], warnings: [] }),
};

describe("Artist enrichment routes (HTTP)", () => {
    let app: INestApplication;

    beforeAll(async () => {
        app = await createControllerTestApp(ArtistController, [
            { provide: ArtistService, useValue: mockArtistService },
            { provide: ArtistEnrichmentService, useValue: mockEnrichmentService },
        ]);
    });

    afterAll(async () => {
        await app.close();
    });

    beforeEach(() => {
        jest.clearAllMocks();
        mockArtistService.authorizeProfileEdit.mockResolvedValue({ id: "artist-1", displayName: "Ada Example" });
        mockEnrichmentService.findCandidates.mockResolvedValue([]);
        mockEnrichmentService.buildSuggestions.mockResolvedValue({
            candidate: { id: "12345678-1234-4234-8234-123456789abc", name: "Ada Example" },
            suggestions: [],
            warnings: [],
        });
    });

    it("requires a JWT before either enrichment route reads the artist or calls a provider", async () => {
        await request(app.getHttpServer()).get("/artists/artist-1/enrichment/candidates").expect(401);
        await request(app.getHttpServer()).post("/artists/artist-1/enrichment/suggestions").send({ candidateId: "bad" }).expect(401);

        expect(mockArtistService.authorizeProfileEdit).not.toHaveBeenCalled();
        expect(mockEnrichmentService.findCandidates).not.toHaveBeenCalled();
        expect(mockEnrichmentService.buildSuggestions).not.toHaveBeenCalled();
    });

    it("authorizes before candidate lookup and searches with the current artist name", async () => {
        await request(app.getHttpServer())
            .get("/artists/artist-1/enrichment/candidates")
            .set("Authorization", `Bearer ${authToken("owner-1")}`)
            .expect(200);

        expect(mockArtistService.authorizeProfileEdit).toHaveBeenCalledWith("owner-1", "artist-1");
        expect(mockEnrichmentService.findCandidates).toHaveBeenCalledWith("Ada Example");
    });

    it("authorizes before loading the explicitly selected candidate", async () => {
        const candidateId = "12345678-1234-4234-8234-123456789abc";
        const response = await request(app.getHttpServer())
            .post("/artists/artist-1/enrichment/suggestions")
            .set("Authorization", `Bearer ${authToken("profile-editor")}`)
            .send({ candidateId })
            .expect(200);

        expect(response.body).toEqual({
            candidate: { id: candidateId, name: "Ada Example" },
            suggestions: [],
            warnings: [],
        });
        expect(mockArtistService.authorizeProfileEdit).toHaveBeenCalledWith("profile-editor", "artist-1");
        expect(mockEnrichmentService.buildSuggestions).toHaveBeenCalledWith(candidateId);
    });

    it("does not call enrichment providers when profile_edit authorization fails", async () => {
        mockArtistService.authorizeProfileEdit.mockRejectedValue(new ForbiddenException("You do not manage this artist profile"));

        await request(app.getHttpServer())
            .get("/artists/artist-1/enrichment/candidates")
            .set("Authorization", `Bearer ${authToken("intruder")}`)
            .expect(403);
        await request(app.getHttpServer())
            .post("/artists/artist-1/enrichment/suggestions")
            .set("Authorization", `Bearer ${authToken("intruder")}`)
            .send({ candidateId: "12345678-1234-4234-8234-123456789abc" })
            .expect(403);

        expect(mockEnrichmentService.findCandidates).not.toHaveBeenCalled();
        expect(mockEnrichmentService.buildSuggestions).not.toHaveBeenCalled();
    });

    it("tracks both enrichment route limits by client IP before JWT guards", () => {
        for (const handler of [
            ArtistController.prototype.getEnrichmentCandidates,
            ArtistController.prototype.getEnrichmentSuggestions,
        ]) {
            expect(Reflect.getMetadata(`${THROTTLER_LIMIT}default`, handler)).toBe(10);
            expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(hours(1));
            const getTracker = Reflect.getMetadata(`${THROTTLER_TRACKER}default`, handler) as (req: Record<string, any>) => string;
            expect(getTracker({ user: { userId: "owner-1" }, ip: "127.0.0.1" })).toBe("127.0.0.1");
            expect(getTracker({ ip: "127.0.0.1" })).toBe("127.0.0.1");
        }
    });
});
