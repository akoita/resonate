/**
 * Prisma seed script — creates deterministic test data for E2E tests.
 *
 * All IDs are fixed so the script is idempotent (safe to re-run).
 * Run via: npx prisma db seed
 */
import { PrismaClient } from "@prisma/client";

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

const SELLER = "0x1234567890abcdef1234567890abcdef12345678";
const NOW = new Date();

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

    // 2. Artist
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

    // 3. Release
    await prisma.release.upsert({
        where: { id: RELEASE_ID },
        update: {},
        create: {
            id: RELEASE_ID,
            artistId: ARTIST_ID,
            title: "Test Release",
            status: "ready",
            type: "Single",
            primaryArtist: "Test Artist",
            genre: "Electronic",
            releaseDate: NOW,
        },
    });

    // 4. Track
    await prisma.track.upsert({
        where: { id: TRACK_ID },
        update: {},
        create: {
            id: TRACK_ID,
            title: "Groove Track",
            releaseId: RELEASE_ID,
            artist: "Test Artist",
            processingStatus: "complete",
            position: 1,
        },
    });

    // 5. Stems
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

    // 6. StemNftMint (link vocals stem to a token)
    await prisma.stemNftMint.upsert({
        where: { id: MINT_ID },
        update: {},
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

    // 7. Listings — two active listings with different prices and expiry
    await prisma.stemListing.upsert({
        where: { id: LISTING_1_ID },
        update: { status: "active", expiresAt: new Date(Date.now() + 7 * 86400000) },
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
            expiresAt: new Date(Date.now() + 7 * 86400000), // 7 days
            transactionHash: "0xe2e_list_tx_00000000000000000000000000000001",
            blockNumber: BigInt(2),
            status: "active",
            listedAt: NOW,
        },
    });

    await prisma.stemListing.upsert({
        where: { id: LISTING_2_ID },
        update: { status: "active", expiresAt: new Date(Date.now() + 3600000) },
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
            expiresAt: new Date(Date.now() + 3600000), // 1 hour — triggers urgent expiry badge
            transactionHash: "0xe2e_list_tx_00000000000000000000000000000002",
            blockNumber: BigInt(3),
            status: "active",
            listedAt: new Date(Date.now() - 86400000), // listed 1 day ago
        },
    });

    console.log("✅ Seed complete: 1 user, 1 artist, 1 release, 1 track, 3 stems, 1 mint, 2 listings");
}

main()
    .catch((e) => {
        console.error("❌ Seed failed:", e);
        process.exit(1);
    })
    .finally(() => prisma.$disconnect());
