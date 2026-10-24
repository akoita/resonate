import { ManagementGrantStatus, ManagementScope } from "@prisma/client";
import request from "supertest";
import { prisma } from "../db/prisma";
import { ArtistController } from "../modules/artist/artist.controller";
import { ArtistEnrichmentService } from "../modules/artist/artist-enrichment.service";
import { ArtistService } from "../modules/artist/artist.service";
import { EventBus } from "../modules/shared/event_bus";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const TEST_PREFIX = `artist_enrichment_${Date.now()}_`;
const OWNER_ID = `${TEST_PREFIX}owner`;
const PROFILE_EDITOR_ID = `${TEST_PREFIX}profile_editor`;
const NON_MANAGER_ID = `${TEST_PREFIX}non_manager`;
const ARTIST_ID = `${TEST_PREFIX}artist`;
const GRANT_ID = `${TEST_PREFIX}profile_edit_grant`;

const mockEnrichmentService = {
    findCandidates: jest.fn().mockResolvedValue([]),
    buildSuggestions: jest.fn().mockResolvedValue({ candidate: null, suggestions: [], warnings: [] }),
};

describe("Artist enrichment profile authorization (integration)", () => {
    let app: Awaited<ReturnType<typeof createControllerTestApp>>;
    let eventBus: EventBus;

    beforeAll(async () => {
        await prisma.user.createMany({
            data: [OWNER_ID, PROFILE_EDITOR_ID, NON_MANAGER_ID].map((id) => ({
                id,
                email: `${id}@test.resonate`,
            })),
        });
        await prisma.artist.create({
            data: {
                id: ARTIST_ID,
                userId: OWNER_ID,
                displayName: "Integration Artist",
                profileType: "manager",
                claimStatus: "claimed",
            },
        });
        await prisma.managementGrant.create({
            data: {
                id: GRANT_ID,
                artistId: ARTIST_ID,
                granteeUserId: PROFILE_EDITOR_ID,
                inviterUserId: OWNER_ID,
                scopes: [ManagementScope.PROFILE_EDIT],
                status: ManagementGrantStatus.active,
                acceptedAt: new Date(),
            },
        });

        eventBus = new EventBus();
        app = await createControllerTestApp(ArtistController, [
            { provide: ArtistService, useValue: new ArtistService(eventBus) },
            { provide: ArtistEnrichmentService, useValue: mockEnrichmentService },
        ]);
    });

    afterAll(async () => {
        await app?.close();
        await prisma.managementGrant.deleteMany({ where: { id: GRANT_ID } }).catch(() => {});
        await prisma.artist.deleteMany({ where: { id: ARTIST_ID } }).catch(() => {});
        await prisma.user.deleteMany({ where: { id: { in: [OWNER_ID, PROFILE_EDITOR_ID, NON_MANAGER_ID] } } }).catch(() => {});
        eventBus?.destroy();
    });

    beforeEach(() => {
        jest.clearAllMocks();
    });

    it("allows the artist owner and a PROFILE_EDIT grantee to reach the provider", async () => {
        await request(app.getHttpServer())
            .get(`/artists/${ARTIST_ID}/enrichment/candidates`)
            .set("Authorization", `Bearer ${authToken(OWNER_ID)}`)
            .expect(200);
        await request(app.getHttpServer())
            .post(`/artists/${ARTIST_ID}/enrichment/suggestions`)
            .set("Authorization", `Bearer ${authToken(PROFILE_EDITOR_ID)}`)
            .send({ candidateId: "12345678-1234-4234-8234-123456789abc" })
            .expect(200);

        expect(mockEnrichmentService.findCandidates).toHaveBeenCalledWith("Integration Artist");
        expect(mockEnrichmentService.buildSuggestions).toHaveBeenCalledWith("12345678-1234-4234-8234-123456789abc");
    });

    it("denies a non-manager before either provider method is called", async () => {
        await request(app.getHttpServer())
            .get(`/artists/${ARTIST_ID}/enrichment/candidates`)
            .set("Authorization", `Bearer ${authToken(NON_MANAGER_ID)}`)
            .expect(403);
        await request(app.getHttpServer())
            .post(`/artists/${ARTIST_ID}/enrichment/suggestions`)
            .set("Authorization", `Bearer ${authToken(NON_MANAGER_ID)}`)
            .send({ candidateId: "12345678-1234-4234-8234-123456789abc" })
            .expect(403);

        expect(mockEnrichmentService.findCandidates).not.toHaveBeenCalled();
        expect(mockEnrichmentService.buildSuggestions).not.toHaveBeenCalled();
        await expectNoStoredIds();
    });

    describe("stored external ids (#2258)", () => {
        const MBID = "5b11f4ce-a62d-471e-81fc-a69a8278c7da";
        const OTHER_MBID = "9c9f1380-2016-4671-bd33-b42a0d4a8c80";

        function resolve(candidate: { id: string; name: string } | null, wikidataId: string | null) {
            mockEnrichmentService.buildSuggestions.mockResolvedValueOnce({
                candidate,
                wikidataId,
                suggestions: [],
                warnings: [],
            });
        }

        function suggest(userId: string = OWNER_ID) {
            return request(app.getHttpServer())
                .post(`/artists/${ARTIST_ID}/enrichment/suggestions`)
                .set("Authorization", `Bearer ${authToken(userId)}`)
                .send({ candidateId: MBID });
        }

        beforeEach(async () => {
            await clearStoredIds();
        });

        it("writes the ids, confidence and match time when enrichment resolves the artist", async () => {
            resolve({ id: MBID, name: "Integration Artist" }, "Q42");
            const before = Date.now();

            await suggest().expect(200);

            const stored = await storedIds();
            expect(stored).toMatchObject({
                musicbrainzArtistId: MBID,
                wikidataQid: "Q42",
                externalIdMatchConfidence: "high",
            });
            expect(stored.externalIdMatchedAt?.getTime()).toBeGreaterThanOrEqual(before);
            expect(stored.externalIdMatchedAt?.getTime()).toBeLessThanOrEqual(Date.now());
        });

        it("lets a PROFILE_EDIT grantee store ids and stores a null QID when there is none", async () => {
            resolve({ id: MBID, name: "Integration Artist Band" }, null);

            await suggest(PROFILE_EDITOR_ID).expect(200);

            expect(await storedIds()).toMatchObject({
                musicbrainzArtistId: MBID,
                wikidataQid: null,
                externalIdMatchConfidence: "medium",
            });
        });

        it("records a differently named record as a low-confidence match", async () => {
            resolve({ id: MBID, name: "Somebody Else" }, "Q7");

            await suggest().expect(200);

            expect(await storedIds()).toMatchObject({
                musicbrainzArtistId: MBID,
                externalIdMatchConfidence: "low",
            });
        });

        it("replaces the previous match as a unit when a different record is resolved", async () => {
            resolve({ id: MBID, name: "Integration Artist" }, "Q42");
            await suggest().expect(200);
            resolve({ id: OTHER_MBID, name: "Integration Artist" }, null);

            await suggest().expect(200);

            expect(await storedIds()).toMatchObject({
                musicbrainzArtistId: OTHER_MBID,
                wikidataQid: null,
                externalIdMatchConfidence: "high",
            });
        });

        it("writes nothing for an unusable resolution", async () => {
            resolve(null, "Q42");
            await suggest().expect(200);
            resolve({ id: "not-a-uuid", name: "Integration Artist" }, "Q42");
            await suggest().expect(200);
            resolve({ id: MBID, name: "   " }, "Q42");
            await suggest().expect(200);

            await expectNoStoredIds();
        });

        it("drops a malformed QID but keeps the MusicBrainz id", async () => {
            resolve({ id: MBID.toUpperCase(), name: "Integration Artist" }, "42");

            await suggest().expect(200);

            expect(await storedIds()).toMatchObject({ musicbrainzArtistId: MBID, wikidataQid: null });
        });

        it("writes nothing when the caller is not authorised", async () => {
            resolve({ id: MBID, name: "Integration Artist" }, "Q42");

            await suggest(NON_MANAGER_ID).expect(403);

            await expectNoStoredIds();
        });

        it("recordEnrichmentMatch reports false for an unknown artist", async () => {
            const artistService = new ArtistService(eventBus);

            await expect(
                artistService.recordEnrichmentMatch(`${TEST_PREFIX}missing`, {
                    candidate: { id: MBID, name: "Integration Artist" },
                    wikidataId: "Q42",
                }),
            ).resolves.toBe(false);
        });
    });
});

function storedIds() {
    return prisma.artist.findUniqueOrThrow({
        where: { id: ARTIST_ID },
        select: {
            musicbrainzArtistId: true,
            wikidataQid: true,
            externalIdMatchConfidence: true,
            externalIdMatchedAt: true,
        },
    });
}

function clearStoredIds() {
    return prisma.artist.update({
        where: { id: ARTIST_ID },
        data: {
            musicbrainzArtistId: null,
            wikidataQid: null,
            externalIdMatchConfidence: null,
            externalIdMatchedAt: null,
        },
    });
}

async function expectNoStoredIds() {
    expect(await storedIds()).toEqual({
        musicbrainzArtistId: null,
        wikidataQid: null,
        externalIdMatchConfidence: null,
        externalIdMatchedAt: null,
    });
}
