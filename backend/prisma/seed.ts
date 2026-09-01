/**
 * Prisma seed script — creates deterministic test data for E2E tests.
 *
 * All IDs are fixed so the script is idempotent (safe to re-run).
 * Run via: npx prisma db seed
 */
import { Prisma, PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

// ─── Fixed IDs ──────────────────────────────────────────────────────────────
const USER_ID = "e2e-user-00000000-0000-0000-0000-000000000001";
const ARTIST_ID = "e2e-artist-0000-0000-0000-000000000001";
const RELEASE_ID = "e2e-release-000-0000-0000-000000000001";
const TRACK_ID = "e2e-track-0000-0000-0000-000000000001";
const STEM_VOCALS_ID = "e2e-stem-vocals-0000-0000-000000000001";
const STEM_DRUMS_ID = "e2e-stem-drums--0000-0000-000000000001";
const STEM_BASS_ID = "e2e-stem-bass---0000-0000-000000000001";
const LISTING_1_ID = "e2e-listing-001-0000-0000-000000000001";
const LISTING_2_ID = "e2e-listing-002-0000-0000-000000000001";
const MINT_ID = "e2e-mint-000-0000-0000-0000-000000000001";
const WALLET_ID = "e2e-wallet-0000-0000-0000-000000000001";
const COMMUNITY_PROFILE_ID = "e2e-community-profile-0000-0000-000000000001";
const COMMUNITY_ROLE_ID = "e2e-community-role-0000-0000-000000000001";
const COMMUNITY_COHORT_ID = "e2e-community-cohort-0000-0000-000000000001";
const COMMUNITY_COHORT_MEMBERSHIP_ID = "e2e-community-membership-0000-0000-000000000001";
const COMMUNITY_BENEFIT_ID = "e2e-community-benefit-0000-0000-000000000001";

const SELLER = "0x1234567890abcdef1234567890abcdef12345678";
const NOW = new Date();
const DAY_MS = 24 * 60 * 60 * 1000;

async function main() {
    console.log("🌱 Seeding E2E test data...");

    // 1. User
    await prisma.user.upsert({
        where: { id: USER_ID },
        update: {},
        create: {
            id: USER_ID,
            email: "e2e-test@resonate.is",
        },
    });

    // 2. Wallet used by the real seeded-owner capture login.
    await prisma.wallet.upsert({
        where: { userId: USER_ID },
        update: {
            userId: USER_ID,
            address: SELLER,
            chainId: 31337,
            balanceUsd: 25,
            monthlyCapUsd: 100,
            spentUsd: 0,
            accountType: "local",
            provider: "local",
            ownerAddress: null,
        },
        create: {
            id: WALLET_ID,
            userId: USER_ID,
            address: SELLER,
            chainId: 31337,
            balanceUsd: 25,
            monthlyCapUsd: 100,
            spentUsd: 0,
            accountType: "local",
            provider: "local",
        },
    });

    // 3. Artist
    await prisma.artist.upsert({
        where: { id: ARTIST_ID },
        update: {},
        create: {
            id: ARTIST_ID,
            userId: USER_ID,
            displayName: "Test Artist",
            payoutAddress: SELLER,
        },
    });

    // 4. Release
    await prisma.release.upsert({
        where: { id: RELEASE_ID },
        update: {
            title: "Test Release",
            status: "ready",
            type: "Single",
            primaryArtist: "Test Artist",
            genre: "Electronic",
            releaseDate: NOW,
            rightsRoute: "STANDARD_ESCROW",
        },
        create: {
            id: RELEASE_ID,
            artistId: ARTIST_ID,
            title: "Test Release",
            status: "ready",
            type: "Single",
            primaryArtist: "Test Artist",
            genre: "Electronic",
            releaseDate: NOW,
            rightsRoute: "STANDARD_ESCROW",
        },
    });

    // 5. Track
    await prisma.track.upsert({
        where: { id: TRACK_ID },
        update: {
            title: "Groove Track",
            artist: "Test Artist",
            processingStatus: "complete",
            position: 1,
        },
        create: {
            id: TRACK_ID,
            title: "Groove Track",
            releaseId: RELEASE_ID,
            artist: "Test Artist",
            processingStatus: "complete",
            position: 1,
        },
    });

    // 6. Stems
    const stems = [
        { id: STEM_VOCALS_ID, type: "vocals", title: "Vocals Stem" },
        { id: STEM_DRUMS_ID, type: "drums", title: "Drums Stem" },
        { id: STEM_BASS_ID, type: "bass", title: "Bass Line" },
    ];

    for (const s of stems) {
        await prisma.stem.upsert({
            where: { id: s.id },
            update: { title: s.title, type: s.type },
            create: {
                id: s.id,
                trackId: TRACK_ID,
                type: s.type,
                title: s.title,
                uri: `/stems/${s.id}.mp3`,
                storageProvider: "local",
            },
        });
    }

    // 7. StemNftMint (link vocals stem to a token)
    await prisma.stemNftMint.upsert({
        where: { id: MINT_ID },
        update: {
            stemId: STEM_VOCALS_ID,
            tokenId: BigInt(42),
            chainId: 31337,
            contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
            creatorAddress: SELLER,
            royaltyBps: 500,
            remixable: true,
            metadataUri: "ipfs://test-metadata",
            transactionHash: "0xe2e_mint_tx_00000000000000000000000000000001",
            blockNumber: BigInt(1),
            mintedAt: NOW,
        },
        create: {
            id: MINT_ID,
            stemId: STEM_VOCALS_ID,
            tokenId: BigInt(42),
            chainId: 31337,
            contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
            creatorAddress: SELLER,
            royaltyBps: 500,
            remixable: true,
            metadataUri: "ipfs://test-metadata",
            transactionHash: "0xe2e_mint_tx_00000000000000000000000000000001",
            blockNumber: BigInt(1),
            mintedAt: NOW,
        },
    });

    // 8. Listings — two active listings with different prices and expiry
    await prisma.stemListing.upsert({
        where: { id: LISTING_1_ID },
        update: {
            status: "active",
            expiresAt: new Date(NOW.getTime() + 7 * DAY_MS),
            listedAt: NOW,
        },
        create: {
            id: LISTING_1_ID,
            listingId: BigInt(1),
            stemId: STEM_VOCALS_ID,
            tokenId: BigInt(42),
            chainId: 31337,
            contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
            sellerAddress: SELLER,
            pricePerUnit: "1000000000000000000", // 1 ETH
            amount: BigInt(50),
            paymentToken: "0x0000000000000000000000000000000000000000",
            expiresAt: new Date(NOW.getTime() + 7 * DAY_MS), // 7 days
            transactionHash: "0xe2e_list_tx_00000000000000000000000000000001",
            blockNumber: BigInt(2),
            status: "active",
            listedAt: NOW,
        },
    });

    await prisma.stemListing.upsert({
        where: { id: LISTING_2_ID },
        update: {
            status: "active",
            expiresAt: new Date(NOW.getTime() + 3600000),
            listedAt: new Date(NOW.getTime() - DAY_MS),
        },
        create: {
            id: LISTING_2_ID,
            listingId: BigInt(2),
            stemId: STEM_BASS_ID,
            tokenId: BigInt(43),
            chainId: 31337,
            contractAddress: "0x5FbDB2315678afecb367f032d93F642f64180aa3",
            sellerAddress: SELLER,
            pricePerUnit: "500000000000000000", // 0.5 ETH
            amount: BigInt(100),
            paymentToken: "0x0000000000000000000000000000000000000000",
            expiresAt: new Date(NOW.getTime() + 3600000), // 1 hour — triggers urgent expiry badge
            transactionHash: "0xe2e_list_tx_00000000000000000000000000000002",
            blockNumber: BigInt(3),
            status: "active",
            listedAt: new Date(NOW.getTime() - DAY_MS), // listed 1 day ago
        },
    });

    // 9. Community visibility, role proof, cohort, and benefit fixtures used
    // by the seeded-owner guide screenshot pass.
    await prisma.communityProfile.upsert({
        where: { userId: USER_ID },
        update: {
            userId: USER_ID,
            displayName: "Test Listener",
            bio: "A seeded listener profile for local previews.",
            profileVisibility: "community",
            updatedAt: NOW,
        },
        create: {
            id: COMMUNITY_PROFILE_ID,
            userId: USER_ID,
            displayName: "Test Listener",
            bio: "A seeded listener profile for local previews.",
            profileVisibility: "community",
        },
    });

    await prisma.communityVisibilitySettings.upsert({
        where: { userId: USER_ID },
        update: {
            showTasteBadges: true,
            showOwnedItems: false,
            showCampaignSupport: false,
            showShowAttendance: false,
            showPlaylists: true,
            showWalletAddress: false,
            allowTasteMatching: true,
            allowCityScenes: true,
        },
        create: {
            userId: USER_ID,
            showTasteBadges: true,
            showOwnedItems: false,
            showCampaignSupport: false,
            showShowAttendance: false,
            showPlaylists: true,
            showWalletAddress: false,
            allowTasteMatching: true,
            allowCityScenes: true,
        },
    });

    await prisma.communityRole.upsert({
        where: {
            CommunityRole_identity: {
                userId: USER_ID,
                roleType: "holder",
                scopeType: "artist",
                scopeId: ARTIST_ID,
            },
        },
        update: {
            sourceType: "e2e_seed",
            sourceId: STEM_VOCALS_ID,
            visibility: "private",
            grantedAt: NOW,
            revokedAt: null,
        },
        create: {
            id: COMMUNITY_ROLE_ID,
            userId: USER_ID,
            roleType: "holder",
            scopeType: "artist",
            scopeId: ARTIST_ID,
            sourceType: "e2e_seed",
            sourceId: STEM_VOCALS_ID,
            visibility: "private",
            grantedAt: NOW,
        },
    });

    await prisma.communityCohort.upsert({
        where: { id: COMMUNITY_COHORT_ID },
        update: {
            cohortType: "artist_affinity",
            reasonCode: "artist_affinity:test_artist",
            title: "Groove Track listeners",
            safeExplanation: "A privacy-safe group for listeners who share an artist affinity.",
            minimumSize: 5,
            visibleMemberCount: 12,
            status: "active",
            metadata: { source: "e2e_seed" },
            expiresAt: new Date(NOW.getTime() + 30 * DAY_MS),
        },
        create: {
            id: COMMUNITY_COHORT_ID,
            cohortType: "artist_affinity",
            reasonCode: "artist_affinity:test_artist",
            title: "Groove Track listeners",
            safeExplanation: "A privacy-safe group for listeners who share an artist affinity.",
            minimumSize: 5,
            visibleMemberCount: 12,
            status: "active",
            metadata: { source: "e2e_seed" },
            expiresAt: new Date(NOW.getTime() + 30 * DAY_MS),
        },
    });

    await prisma.communityCohortMembership.upsert({
        where: {
            CommunityCohortMembership_identity: {
                cohortId: COMMUNITY_COHORT_ID,
                userId: USER_ID,
            },
        },
        update: {
            status: "joined",
            suggestedAt: NOW,
            suggestedEventAt: NOW,
            joinedAt: NOW,
            leftAt: null,
            hiddenAt: null,
        },
        create: {
            id: COMMUNITY_COHORT_MEMBERSHIP_ID,
            cohortId: COMMUNITY_COHORT_ID,
            userId: USER_ID,
            status: "joined",
            suggestedAt: NOW,
            suggestedEventAt: NOW,
            joinedAt: NOW,
        },
    });

    await prisma.communityBenefitRule.upsert({
        where: { id: COMMUNITY_BENEFIT_ID },
        update: {
            artistId: ARTIST_ID,
            title: "Test Artist holder room access",
            description: "A seeded holder benefit available to this listener account.",
            benefitType: "room_access",
            eligibilityPolicy: {
                type: "role",
                roleType: "holder",
                scopeType: "artist",
                scopeId: ARTIST_ID,
            },
            redemptionPolicy: { singleUse: true, settlementType: "none" },
            status: "active",
            startsAt: new Date(NOW.getTime() - DAY_MS),
            endsAt: new Date(NOW.getTime() + 30 * DAY_MS),
        },
        create: {
            id: COMMUNITY_BENEFIT_ID,
            artistId: ARTIST_ID,
            title: "Test Artist holder room access",
            description: "A seeded holder benefit available to this listener account.",
            benefitType: "room_access",
            eligibilityPolicy: {
                type: "role",
                roleType: "holder",
                scopeType: "artist",
                scopeId: ARTIST_ID,
            },
            redemptionPolicy: { singleUse: true, settlementType: "none" },
            status: "active",
            startsAt: new Date(NOW.getTime() - DAY_MS),
            endsAt: new Date(NOW.getTime() + 30 * DAY_MS),
        },
    });

    // 10. Recent analytics event ledger rows for a non-empty owner dashboard.
    await seedAnalyticsEvents();

    console.log(
        "✅ Seed complete: 1 user, 1 wallet, 1 artist, 1 release, 1 track, 3 stems, 1 mint, 2 listings, 7 playback events, 2 payout events, 1 rights decision, 1 cohort, 1 community benefit",
    );
}

type SeedAnalyticsEvent = {
    eventId: string;
    eventName: string;
    eventVersion: number;
    occurredAt: Date;
    receivedAt: Date;
    producer: string;
    environment: "local";
    privacyTier: "pseudonymous";
    subjectType: string;
    subjectId: string;
    actorId: string;
    sessionId?: string;
    traceId: string;
    schemaUri: string;
    payload: Record<string, unknown>;
    sourceRefs: Record<string, string>;
};

async function seedAnalyticsEvents() {
    const events: SeedAnalyticsEvent[] = [
        ...[
            [14, "web_player", "e2e-session-web", 0.96],
            [11, "web_player", "e2e-session-web", 0.91],
            [8, "library", "e2e-session-library", 0.88],
            [6, "ai_dj", "e2e-session-ai-dj", 0.94],
            [4, "ai_dj", "e2e-session-ai-dj", 0.97],
            [2, "web_player", "e2e-session-web", 0.99],
            [1, "playlist", "e2e-session-playlist", 0.9],
        ].map(([daysAgo, source, sessionId, completionRatio], index) =>
            createAnalyticsEvent(
                `e2e-analytics-play-${String(index + 1).padStart(3, "0")}`,
                "playback.completed",
                Number(daysAgo),
                {
                    trackId: TRACK_ID,
                    artistId: ARTIST_ID,
                    releaseId: RELEASE_ID,
                    title: "Groove Track",
                    completionRatio: Number(completionRatio),
                    durationMs: 212000,
                    source,
                    playbackInstanceId: `e2e-playback-${String(index + 1).padStart(3, "0")}`,
                },
                {
                    producer: "playback-service",
                    sessionId: String(sessionId),
                    subjectType: "track",
                    subjectId: TRACK_ID,
                },
            ),
        ),
        createAnalyticsEvent(
            "e2e-analytics-payout-001",
            "payment.settled",
            5,
            {
                trackId: TRACK_ID,
                artistId: ARTIST_ID,
                releaseId: RELEASE_ID,
                canonicalAmountUsd: 4.25,
                amountUsd: 4.25,
                settlementAmount: "4.25",
                settlementAmountUnits: "4250000",
                paymentToken: "0x0000000000000000000000000000000000000000",
                paymentAssetSymbol: "USDC",
                paymentAssetDecimals: 6,
                source: "marketplace",
            },
            {
                producer: "payments-service",
                sessionId: "e2e-session-web",
                subjectType: "track",
                subjectId: TRACK_ID,
            },
        ),
        createAnalyticsEvent(
            "e2e-analytics-payout-002",
            "commerce.settled",
            3,
            {
                trackId: TRACK_ID,
                artistId: ARTIST_ID,
                releaseId: RELEASE_ID,
                canonicalAmountUsd: 1.75,
                amountUsd: 1.75,
                settlementAmount: "1.75",
                settlementAmountUnits: "1750000",
                paymentToken: "0x0000000000000000000000000000000000000000",
                paymentAssetSymbol: "USDC",
                paymentAssetDecimals: 6,
                source: "listener_support",
            },
            {
                producer: "payments-service",
                sessionId: "e2e-session-library",
                subjectType: "track",
                subjectId: TRACK_ID,
            },
        ),
        createAnalyticsEvent(
            "e2e-analytics-rights-001",
            "rights.route_decided",
            2,
            {
                releaseId: RELEASE_ID,
                artistId: ARTIST_ID,
                route: "STANDARD_ESCROW",
                evidenceTypes: ["self_attestation"],
                decisionReason: "Seeded release is ready for the marketplace route.",
            },
            {
                producer: "rights-service",
                subjectType: "release",
                subjectId: RELEASE_ID,
            },
        ),
    ];

    for (const event of events) {
        const envelope = {
            ...event,
            occurredAt: event.occurredAt.toISOString(),
            receivedAt: event.receivedAt.toISOString(),
        };
        await prisma.analyticsEvent.upsert({
            where: { eventId: event.eventId },
            update: {
                eventName: event.eventName,
                eventVersion: event.eventVersion,
                occurredAt: event.occurredAt,
                receivedAt: event.receivedAt,
                producer: event.producer,
                environment: event.environment,
                privacyTier: event.privacyTier,
                subjectType: event.subjectType,
                subjectId: event.subjectId,
                actorId: event.actorId,
                sessionId: event.sessionId,
                traceId: event.traceId,
                schemaUri: event.schemaUri,
                consentBasis: null,
                payload: event.payload as Prisma.InputJsonValue,
                sourceRefs: event.sourceRefs as Prisma.InputJsonValue,
                envelope: envelope as Prisma.InputJsonValue,
            },
            create: {
                eventId: event.eventId,
                eventName: event.eventName,
                eventVersion: event.eventVersion,
                occurredAt: event.occurredAt,
                receivedAt: event.receivedAt,
                producer: event.producer,
                environment: event.environment,
                privacyTier: event.privacyTier,
                subjectType: event.subjectType,
                subjectId: event.subjectId,
                actorId: event.actorId,
                sessionId: event.sessionId,
                traceId: event.traceId,
                schemaUri: event.schemaUri,
                payload: event.payload as Prisma.InputJsonValue,
                sourceRefs: event.sourceRefs as Prisma.InputJsonValue,
                envelope: envelope as Prisma.InputJsonValue,
            },
        });
    }
}

function createAnalyticsEvent(
    eventId: string,
    eventName: string,
    daysAgo: number,
    payload: Record<string, unknown>,
    options: {
        producer: string;
        sessionId?: string;
        subjectType: string;
        subjectId: string;
    },
): SeedAnalyticsEvent {
    const occurredAt = new Date(NOW.getTime() - daysAgo * DAY_MS);
    return {
        eventId,
        eventName,
        eventVersion: 1,
        occurredAt,
        receivedAt: NOW,
        producer: options.producer,
        environment: "local",
        privacyTier: "pseudonymous",
        subjectType: options.subjectType,
        subjectId: options.subjectId,
        actorId: USER_ID,
        sessionId: options.sessionId,
        traceId: `${eventId}-trace`,
        schemaUri: `analytics://${eventName}/v1`,
        payload,
        sourceRefs: { seed: "e2e-owner-guide" },
    };
}

main()
    .catch((e) => {
        console.error("❌ Seed failed:", e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
