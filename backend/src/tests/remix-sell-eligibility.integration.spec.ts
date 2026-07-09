/**
 * Remix Sell-Eligibility — Integration Test (Testcontainers) (#1413)
 *
 * Closes a rights hole: minting a published remix's master stem (to list it
 * for sale) previously enforced only the upload rights *route*
 * (assertMarketplaceAllowedForStem) and never the eligibility engine's
 * `export` (commercial) action — so a remix built entirely from remix-tier
 * (non-commercial) source licenses could be minted and listed.
 *
 * Covers:
 *   - MintAuthorizationService.createAuthorization rejects minting a remix
 *     master with `remix_sell_rights_required` when the source stems are
 *     only remix-licensed (not commercial);
 *   - it succeeds (reaches a signed authorization) when the source stems are
 *     commercial-licensed, or when the caller owns the source artist
 *     profile (creatorOwner);
 *   - a normal (non-remix) stem's authorization path is unaffected;
 *   - the DB-relation lineage lookup (Release.publishedRemixProject) is
 *     preferred, with a documented fallback to track.generationMetadata;
 *   - RemixProjectService.getSellEligibility returns the right `commerce`
 *     shape for published-eligible / published-ineligible / unpublished
 *     projects.
 *
 * Run: npm run test:integration -- --testPathPattern='remix-sell-eligibility'
 */

import { ConfigService } from "@nestjs/config";
import { ForbiddenException } from "@nestjs/common";
import { getAddress } from "viem";
import { prisma } from "../db/prisma";
import { EventBus } from "../modules/shared/event_bus";
import { MintAuthorizationService } from "../modules/contracts/mint-authorization.service";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";
import { RemixEligibilityService } from "../modules/remix/remix-eligibility.service";
import { RemixProjectService } from "../modules/remix/remix-project.service";
import { StubRemixGenerationProvider } from "../modules/remix/remix-generation.provider";
import { stubGenerationCredits } from "./e2e-helpers";

const TEST_PREFIX = `remix_sell_${Date.now()}_`;

// Well-known Hardhat/Anvil test account #0 private key — a public testing
// convention, never a real secret. Used only to derive a local EIP-712
// signature; no network/RPC call is made for it.
const MINT_AUTHORIZER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
// Arbitrary, fixed, valid test address used as both the minting wallet and
// the ContentAttestation attester for every release in this suite — the gate
// under test does not care which address mints, so one fixed address keeps
// the fixtures simple.
const MINTER_ADDRESS = `0x${"11".repeat(20)}`;

const CREATOR_ID = `${TEST_PREFIX}creator`; // remix-tier-only license holder
const COMMERCIAL_USER_ID = `${TEST_PREFIX}commercial_user`; // commercial license holder
const ARTIST_OWNER_ID = `${TEST_PREFIX}artist_owner`; // owns the source artist
const NONREMIX_OWNER_ID = `${TEST_PREFIX}nonremix_owner`; // owns an unrelated stem

const CREATOR_WALLET = `0x${"a1".repeat(20)}`;
const COMMERCIAL_WALLET = `0x${"b2".repeat(20)}`;

const ARTIST_ID = `${TEST_PREFIX}artist`;
const REMIX_ARTIST_A_ID = `${TEST_PREFIX}remix_artist_a`;
const REMIX_ARTIST_B1_ID = `${TEST_PREFIX}remix_artist_b1`;
const NONREMIX_ARTIST_ID = `${TEST_PREFIX}nonremix_artist`;

const SOURCE_RELEASE_ID = `${TEST_PREFIX}source_release`;
const SOURCE_TRACK_ID = `${TEST_PREFIX}source_track`;
const SOURCE_STEM_ID = `${TEST_PREFIX}source_stem`;

/** Mirrors mint-authorization.service.ts's getReleaseMetadataUriCandidates
 * canonical-slug branch for titles with no leading/trailing special chars. */
function releaseMetadataUri(title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return `resonate://release/${slug}`;
}

async function seedRemixRelease(input: {
  releaseId: string;
  trackId: string;
  masterStemId: string;
  artistId: string;
  title: string;
  sourceStemIds: string[];
  attestationTokenId: number;
}) {
  const release = await prisma.release.create({
    data: {
      id: input.releaseId,
      artistId: input.artistId,
      title: input.title,
      status: "ready",
      type: "remix",
      rightsRoute: "STANDARD_ESCROW",
    },
  });
  await prisma.track.create({
    data: {
      id: input.trackId,
      releaseId: release.id,
      title: input.title,
      position: 1,
      contentStatus: "clean",
      rightsRoute: "STANDARD_ESCROW",
      generationMetadata: {
        kind: "remix_publish",
        sourceTrackId: SOURCE_TRACK_ID,
        sourceStemIds: input.sourceStemIds,
      },
    },
  });
  await prisma.stem.create({
    data: {
      id: input.masterStemId,
      trackId: input.trackId,
      type: "master",
      uri: `local://${input.masterStemId}`,
    },
  });
  await prisma.contentAttestation.create({
    data: {
      tokenId: String(input.attestationTokenId),
      chainId: 31337,
      attesterAddress: MINTER_ADDRESS.toLowerCase(),
      contentHash: `${TEST_PREFIX}hash_${input.attestationTokenId}`,
      fingerprintHash: `${TEST_PREFIX}fingerprint_${input.attestationTokenId}`,
      metadataURI: releaseMetadataUri(input.title),
      transactionHash: `${TEST_PREFIX}attest_${input.attestationTokenId}`,
      blockNumber: BigInt(input.attestationTokenId),
    },
  });
  return release;
}

describe("Remix sell-eligibility (integration)", () => {
  let mintAuthorizationService: MintAuthorizationService;
  let remixEligibilityService: RemixEligibilityService;
  let projectService: RemixProjectService;
  let originalStemNftAddress: string | undefined;

  beforeAll(async () => {
    originalStemNftAddress = process.env.STEM_NFT_ADDRESS;
    process.env.STEM_NFT_ADDRESS = `0x${"c3".repeat(20)}`;

    await prisma.user.createMany({
      data: [
        { id: CREATOR_ID, email: `${TEST_PREFIX}creator@test.resonate` },
        {
          id: COMMERCIAL_USER_ID,
          email: `${TEST_PREFIX}commercial@test.resonate`,
        },
        {
          id: ARTIST_OWNER_ID,
          email: `${TEST_PREFIX}artist_owner@test.resonate`,
        },
        {
          id: NONREMIX_OWNER_ID,
          email: `${TEST_PREFIX}nonremix_owner@test.resonate`,
        },
      ],
    });
    await prisma.wallet.createMany({
      data: [
        { userId: CREATOR_ID, address: CREATOR_WALLET, chainId: 31337 },
        {
          userId: COMMERCIAL_USER_ID,
          address: COMMERCIAL_WALLET,
          chainId: 31337,
        },
      ],
    });
    await prisma.artist.createMany({
      data: [
        {
          id: ARTIST_ID,
          userId: ARTIST_OWNER_ID,
          displayName: "Sell Eligibility Source Artist",
          payoutAddress: `0x${"d4".repeat(20)}`,
        },
        {
          id: REMIX_ARTIST_A_ID,
          userId: CREATOR_ID,
          displayName: "Remix Artist A",
          payoutAddress: `0x${"e5".repeat(20)}`,
        },
        {
          id: REMIX_ARTIST_B1_ID,
          userId: COMMERCIAL_USER_ID,
          displayName: "Remix Artist B1",
          payoutAddress: `0x${"f6".repeat(20)}`,
        },
        {
          id: NONREMIX_ARTIST_ID,
          userId: NONREMIX_OWNER_ID,
          displayName: "Non Remix Artist",
          payoutAddress: `0x${"07".repeat(20)}`,
        },
      ],
    });

    // Source chain: one track with one stem, licensed to two different
    // buyers at two different tiers.
    await prisma.release.create({
      data: {
        id: SOURCE_RELEASE_ID,
        artistId: ARTIST_ID,
        title: "Sell Eligibility Source Release",
        status: "ready",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: SOURCE_TRACK_ID,
        releaseId: SOURCE_RELEASE_ID,
        title: "Source Track",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.create({
      data: {
        id: SOURCE_STEM_ID,
        trackId: SOURCE_TRACK_ID,
        type: "vocals",
        uri: "local://source-stem",
      },
    });

    // Remix-tier-only license for CREATOR_ID.
    const remixListing = await prisma.stemListing.create({
      data: {
        listingId: BigInt(8001),
        stemId: SOURCE_STEM_ID,
        tokenId: BigInt(9301),
        chainId: 31337,
        contractAddress: `0x${"c3".repeat(20)}`,
        sellerAddress: `0x${"d4".repeat(20)}`,
        pricePerUnit: "1000000",
        amount: BigInt(10),
        paymentToken: `0x${"0".repeat(40)}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        transactionHash: `${TEST_PREFIX}list_remix`,
        blockNumber: BigInt(301),
        licenseType: "remix",
        status: "active",
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: remixListing.id,
        buyerAddress: CREATOR_WALLET,
        amount: BigInt(1),
        totalPaid: "1000000",
        royaltyPaid: "0",
        protocolFeePaid: "0",
        sellerReceived: "1000000",
        licenseType: "remix",
        transactionHash: `${TEST_PREFIX}buy_remix`,
        blockNumber: BigInt(302),
        purchasedAt: new Date(),
      },
    });

    // Commercial license for COMMERCIAL_USER_ID.
    const commercialListing = await prisma.stemListing.create({
      data: {
        listingId: BigInt(8002),
        stemId: SOURCE_STEM_ID,
        tokenId: BigInt(9301),
        chainId: 31337,
        contractAddress: `0x${"c3".repeat(20)}`,
        sellerAddress: `0x${"d4".repeat(20)}`,
        pricePerUnit: "2000000",
        amount: BigInt(10),
        paymentToken: `0x${"0".repeat(40)}`,
        expiresAt: new Date(Date.now() + 7 * 24 * 3600 * 1000),
        transactionHash: `${TEST_PREFIX}list_commercial`,
        blockNumber: BigInt(303),
        licenseType: "commercial",
        status: "active",
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: commercialListing.id,
        buyerAddress: COMMERCIAL_WALLET,
        amount: BigInt(1),
        totalPaid: "2000000",
        royaltyPaid: "0",
        protocolFeePaid: "0",
        sellerReceived: "2000000",
        licenseType: "commercial",
        transactionHash: `${TEST_PREFIX}buy_commercial`,
        blockNumber: BigInt(304),
        purchasedAt: new Date(),
      },
    });

    // Case (a)/(b1): remix master owned by CREATOR_ID (remix-tier only) and
    // by COMMERCIAL_USER_ID (commercial-licensed).
    await seedRemixRelease({
      releaseId: `${TEST_PREFIX}release_a`,
      trackId: `${TEST_PREFIX}track_a`,
      masterStemId: `${TEST_PREFIX}master_a`,
      artistId: REMIX_ARTIST_A_ID,
      title: "Remix Master A",
      sourceStemIds: [SOURCE_STEM_ID],
      attestationTokenId: 9401,
    });
    await seedRemixRelease({
      releaseId: `${TEST_PREFIX}release_b1`,
      trackId: `${TEST_PREFIX}track_b1`,
      masterStemId: `${TEST_PREFIX}master_b1`,
      artistId: REMIX_ARTIST_B1_ID,
      title: "Remix Master B1",
      sourceStemIds: [SOURCE_STEM_ID],
      attestationTokenId: 9402,
    });
    // Case (b2): the source artist remixing their own track — the remix
    // release is owned by the SAME artist row as the source (ARTIST_ID),
    // so ownership and creatorOwner are both satisfied by ARTIST_OWNER_ID.
    await seedRemixRelease({
      releaseId: `${TEST_PREFIX}release_b2`,
      trackId: `${TEST_PREFIX}track_b2`,
      masterStemId: `${TEST_PREFIX}master_b2`,
      artistId: ARTIST_ID,
      title: "Remix Master B2",
      sourceStemIds: [SOURCE_STEM_ID],
      attestationTokenId: 9403,
    });
    // Case (e): a master stem with NO RemixProject relation pointing at its
    // release, but the same "remix_publish" lineage on generationMetadata —
    // exercises the documented fallback path.
    await seedRemixRelease({
      releaseId: `${TEST_PREFIX}release_e`,
      trackId: `${TEST_PREFIX}track_e`,
      masterStemId: `${TEST_PREFIX}master_e`,
      artistId: REMIX_ARTIST_A_ID,
      title: "Remix Master E Fallback",
      sourceStemIds: [SOURCE_STEM_ID],
      attestationTokenId: 9404,
    });

    // Case (c): a normal, non-remix stem — no RemixProject, no
    // "remix_publish" lineage, and not even a `master`-typed stem. Owned
    // directly by NONREMIX_OWNER_ID.
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release_c`,
        artistId: NONREMIX_ARTIST_ID,
        title: "Ordinary Release C",
        status: "ready",
        type: "single",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.track.create({
      data: {
        id: `${TEST_PREFIX}track_c`,
        releaseId: `${TEST_PREFIX}release_c`,
        title: "Ordinary Track C",
        position: 1,
        contentStatus: "clean",
        rightsRoute: "STANDARD_ESCROW",
      },
    });
    await prisma.stem.create({
      data: {
        id: `${TEST_PREFIX}stem_c`,
        trackId: `${TEST_PREFIX}track_c`,
        type: "vocals",
        uri: "local://ordinary-stem-c",
      },
    });
    await prisma.contentAttestation.create({
      data: {
        tokenId: "9405",
        chainId: 31337,
        attesterAddress: MINTER_ADDRESS.toLowerCase(),
        contentHash: `${TEST_PREFIX}hash_9405`,
        fingerprintHash: `${TEST_PREFIX}fingerprint_9405`,
        metadataURI: releaseMetadataUri("Ordinary Release C"),
        transactionHash: `${TEST_PREFIX}attest_9405`,
        blockNumber: BigInt(9405),
      },
    });

    // Case (d)/PROJECT rows for RemixProjectService.getSellEligibility.
    await prisma.remixProject.create({
      data: {
        id: `${TEST_PREFIX}project_a`,
        creatorUserId: CREATOR_ID,
        sourceTrackId: SOURCE_TRACK_ID,
        title: "Project A (remix-tier only, published)",
        status: "published",
        policyVersion: "test",
        publishedReleaseId: `${TEST_PREFIX}release_a`,
        stems: { create: [{ stemId: SOURCE_STEM_ID }] },
      },
    });
    await prisma.remixProject.create({
      data: {
        id: `${TEST_PREFIX}project_b1`,
        creatorUserId: COMMERCIAL_USER_ID,
        sourceTrackId: SOURCE_TRACK_ID,
        title: "Project B1 (commercial-licensed, published)",
        status: "published",
        policyVersion: "test",
        publishedReleaseId: `${TEST_PREFIX}release_b1`,
        stems: { create: [{ stemId: SOURCE_STEM_ID }] },
      },
    });
    // Also gives release_b2 a real publishedRemixProject relation, so the
    // (b2) creatorOwner case exercises the primary DB-relation lookup (not
    // just the generationMetadata fallback that (e) is dedicated to).
    await prisma.remixProject.create({
      data: {
        id: `${TEST_PREFIX}project_b2`,
        creatorUserId: ARTIST_OWNER_ID,
        sourceTrackId: SOURCE_TRACK_ID,
        title: "Project B2 (creatorOwner, published)",
        status: "published",
        policyVersion: "test",
        publishedReleaseId: `${TEST_PREFIX}release_b2`,
        stems: { create: [{ stemId: SOURCE_STEM_ID }] },
      },
    });
    await prisma.remixProject.create({
      data: {
        id: `${TEST_PREFIX}project_draft`,
        creatorUserId: CREATOR_ID,
        sourceTrackId: SOURCE_TRACK_ID,
        title: "Project Draft (unpublished)",
        status: "draft",
        policyVersion: "test",
        stems: { create: [{ stemId: SOURCE_STEM_ID }] },
      },
    });
  });

  afterAll(async () => {
    process.env.STEM_NFT_ADDRESS = originalStemNftAddress;

    await prisma.remixProject.deleteMany({
      where: {
        creatorUserId: {
          in: [CREATOR_ID, COMMERCIAL_USER_ID, ARTIST_OWNER_ID],
        },
      },
    });
    await prisma.contentAttestation.deleteMany({
      where: { transactionHash: { startsWith: TEST_PREFIX } },
    });
    await prisma.stemPurchase.deleteMany({
      where: { transactionHash: { startsWith: TEST_PREFIX } },
    });
    await prisma.stemListing.deleteMany({
      where: { transactionHash: { startsWith: TEST_PREFIX } },
    });
    await prisma.stem.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.track.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.release.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.artist.deleteMany({
      where: { id: { startsWith: TEST_PREFIX } },
    });
    await prisma.wallet.deleteMany({
      where: { userId: { in: [CREATOR_ID, COMMERCIAL_USER_ID] } },
    });
    await prisma.user.deleteMany({
      where: {
        id: {
          in: [
            CREATOR_ID,
            COMMERCIAL_USER_ID,
            ARTIST_OWNER_ID,
            NONREMIX_OWNER_ID,
          ],
        },
      },
    });
  });

  beforeEach(() => {
    const config = new ConfigService({
      MINT_AUTHORIZER_PRIVATE_KEY: MINT_AUTHORIZER_PRIVATE_KEY,
    });
    remixEligibilityService = new RemixEligibilityService();
    mintAuthorizationService = new MintAuthorizationService(
      config,
      new UploadRightsRoutingService(),
      remixEligibilityService,
    );
    projectService = new RemixProjectService(
      new EventBus(),
      remixEligibilityService,
      new StubRemixGenerationProvider(),
      { render: jest.fn() } as any,
      {
        upload: jest.fn(),
        download: jest.fn(),
        downloadRange: jest.fn(),
        delete: jest.fn(),
      } as any,
      { add: jest.fn().mockResolvedValue({ id: "queued" }) } as any,
      stubGenerationCredits() as any,
    );
  });

  describe("mint-authorization sell-rights gate", () => {
    it("(a) rejects minting a remix master when the source stem is only remix-licensed", async () => {
      const error = await mintAuthorizationService
        .createAuthorization(
          CREATOR_ID,
          {
            stemId: `${TEST_PREFIX}master_a`,
            chainId: 31337,
            minterAddress: MINTER_ADDRESS,
          },
          "http://localhost:3000",
        )
        .then(() => null)
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      const response = error.getResponse() as { code: string; message: string };
      expect(response.code).toBe("remix_sell_rights_required");
      expect(response.message).toMatch(/commercial license/i);
    });

    it("(b1) succeeds when the source stem is commercial-licensed", async () => {
      const result = await mintAuthorizationService.createAuthorization(
        COMMERCIAL_USER_ID,
        {
          stemId: `${TEST_PREFIX}master_b1`,
          chainId: 31337,
          minterAddress: MINTER_ADDRESS,
        },
        "http://localhost:3000",
      );

      expect(result.stemId).toBe(`${TEST_PREFIX}master_b1`);
      expect(result.authorization.minter).toBe(getAddress(MINTER_ADDRESS));
      expect(result.signature).toMatch(/^0x/);
    });

    it("(b2) succeeds when the caller owns the source artist profile (creatorOwner)", async () => {
      const result = await mintAuthorizationService.createAuthorization(
        ARTIST_OWNER_ID,
        {
          stemId: `${TEST_PREFIX}master_b2`,
          chainId: 31337,
          minterAddress: MINTER_ADDRESS,
        },
        "http://localhost:3000",
      );

      expect(result.stemId).toBe(`${TEST_PREFIX}master_b2`);
      expect(result.signature).toMatch(/^0x/);
    });

    it("(c) leaves a normal (non-remix) stem's authorization path unaffected", async () => {
      const result = await mintAuthorizationService.createAuthorization(
        NONREMIX_OWNER_ID,
        {
          stemId: `${TEST_PREFIX}stem_c`,
          chainId: 31337,
          minterAddress: MINTER_ADDRESS,
        },
        "http://localhost:3000",
      );

      expect(result.stemId).toBe(`${TEST_PREFIX}stem_c`);
      expect(result.signature).toMatch(/^0x/);
    });

    it("(e) falls back to generationMetadata lineage when the RemixProject relation is unavailable", async () => {
      // No RemixProject row points at release_e; only the track's
      // generationMetadata carries the remix_publish lineage. CREATOR_ID
      // only holds the remix-tier license, so the fallback path must still
      // deny the mint.
      const error = await mintAuthorizationService
        .createAuthorization(
          CREATOR_ID,
          {
            stemId: `${TEST_PREFIX}master_e`,
            chainId: 31337,
            minterAddress: MINTER_ADDRESS,
          },
          "http://localhost:3000",
        )
        .then(() => null)
        .catch((caught) => caught);

      expect(error).toBeInstanceOf(ForbiddenException);
      const response = error.getResponse() as { code: string };
      expect(response.code).toBe("remix_sell_rights_required");

      const project = await prisma.remixProject.findFirst({
        where: { publishedReleaseId: `${TEST_PREFIX}release_e` },
      });
      expect(project).toBeNull();
    });
  });

  describe("RemixProjectService.getSellEligibility", () => {
    it("(d1) is sellable for a published project whose source stems are commercial-licensed", async () => {
      const result = await projectService.getSellEligibility(
        COMMERCIAL_USER_ID,
        `${TEST_PREFIX}project_b1`,
      );
      expect(result).toEqual({
        sellable: true,
        reasonCode: null,
        reason: null,
        publishedReleaseId: `${TEST_PREFIX}release_b1`,
        masterStemId: `${TEST_PREFIX}master_b1`,
      });
    });

    it("(d2) is not sellable for a published project whose source stems are only remix-licensed", async () => {
      const result = await projectService.getSellEligibility(
        CREATOR_ID,
        `${TEST_PREFIX}project_a`,
      );
      expect(result).toEqual({
        sellable: false,
        reasonCode: "commercial_license_required",
        reason:
          "Listing this remix for sale requires a commercial license on every source stem (or owning the source artist).",
        publishedReleaseId: `${TEST_PREFIX}release_a`,
        masterStemId: `${TEST_PREFIX}master_a`,
      });
    });

    it("(d3) is not sellable (not_published) for a draft project", async () => {
      const result = await projectService.getSellEligibility(
        CREATOR_ID,
        `${TEST_PREFIX}project_draft`,
      );
      expect(result).toEqual({
        sellable: false,
        reasonCode: "not_published",
        reason: "Publish this remix before listing it for sale.",
        publishedReleaseId: null,
        masterStemId: null,
      });
    });

    it("surfaces the same shape under `commerce` on getProject", async () => {
      const project = await projectService.getProject(
        COMMERCIAL_USER_ID,
        `${TEST_PREFIX}project_b1`,
      );
      expect((project as any).commerce).toEqual({
        sellable: true,
        reasonCode: null,
        reason: null,
        publishedReleaseId: `${TEST_PREFIX}release_b1`,
        masterStemId: `${TEST_PREFIX}master_b1`,
      });
    });
  });
});
