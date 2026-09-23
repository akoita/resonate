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
    });
});
