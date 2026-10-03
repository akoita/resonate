/**
 * Crate export — Integration (#1965, docs/features/crate_digger.md)
 *
 * Real Prisma (Testcontainers Postgres); nothing about Prisma is mocked.
 *
 * Covers: only stems the caller's wallet owns under a standard license are
 * exported (highest tier reported), other people's purchases are ignored,
 * sync/sample/broadcast purchases are skipped `no_export_right`, unpurchased
 * and non-current stems are skipped `not_purchased`, crate and stem order,
 * measured tempo/key/first-beat from the stem with a fallback to the track,
 * the manifest shape and notes, the rekordbox and Serato files generated from
 * the same plan, 404 for other users' crates, 409 `no_wallet` and
 * `nothing_to_export` (the manifest still answers), 403 when the policy
 * denies, and that the folder the DJ typed is never stored or logged.
 *
 * Run: npx jest --runInBand --forceExit --config jest.integration.config.js \
 *        --testPathPattern='crate_export.integration'
 */

import { ConflictException, ForbiddenException, Logger, NotFoundException } from "@nestjs/common";
import { prisma } from "../db/prisma";
import { CrateEntitlementsService } from "../modules/crates/crate-entitlements";
import { CrateExportService } from "../modules/crates/crate_export.service";

const TEST_PREFIX = `cexport_${Date.now()}_`;
const id = (key: string) => `${TEST_PREFIX}${key}`;
const hex = (key: string) =>
  `0x${Buffer.from(`${TEST_PREFIX}${key}`).toString("hex").padEnd(64, "0").slice(0, 64)}`;

const DJ = id("dj");
const NO_WALLET_DJ = id("nowallet");
const OTHER_DJ = id("other");
const ARTIST_USER = id("artistuser");
const ARTIST = id("artist");

const CHAIN_ID = 31337;
const MARKETPLACE = `0x${"aB".repeat(20)}`;
const DJ_WALLET = `0x${"Dd".repeat(20)}`;
const OTHER_WALLET = `0x${"ee".repeat(20)}`;
const SELLER = `0x${"5".repeat(40)}`;
const USDC = `0x${"11".repeat(20)}`;

const features = (overrides: Record<string, unknown>) => ({
  schemaVersion: "stem-audio-features/v1",
  extractor: { name: "test", version: "1" },
  tempoBpm: 126,
  tempoConfidence: 0.9,
  firstBeatSec: 0.25,
  key: { tonic: "A", mode: "minor", confidence: 0.5 },
  analysisRevision: 3,
  ...overrides,
});

type SeedStem = { type: string; current?: boolean; features?: Record<string, unknown> };
type SeedTrack = { key: string; artist?: string; stems: SeedStem[] };

const TRACKS: SeedTrack[] = [
  {
    key: "tA",
    artist: "Credited / Name",
    stems: [
      { type: "original", features: features({}) },
      { type: "vocals", features: features({ tempoBpm: 128.004, firstBeatSec: 0.1234, key: { tonic: "C", mode: "major", confidence: 0.5 } }) },
      { type: "drums" },
      { type: "bass" },
      { type: "guitar" },
    ],
  },
  { key: "tB", stems: [{ type: "original" }, { type: "vocals" }] },
  { key: "tC", stems: [{ type: "original" }, { type: "vocals" }] },
  { key: "tD", stems: [{ type: "original" }, { type: "vocals" }, { type: "bass", current: false }] },
  { key: "tE", stems: [{ type: "original" }, { type: "drums" }, { type: "bass" }] },
];

/** Purchases: [buyer, track, stem type, license]. */
const PURCHASES: Array<[string, string, string, string]> = [
  [DJ_WALLET, "tA", "vocals", "personal"],
  [DJ_WALLET, "tA", "vocals", "commercial"],
  [DJ_WALLET, "tA", "drums", "remix"],
  [DJ_WALLET, "tA", "bass", "sync"],
  // Somebody else owns the guitar stem and the whole of tC.
  [OTHER_WALLET, "tA", "guitar", "commercial"],
  [OTHER_WALLET, "tC", "vocals", "personal"],
  // Only a sync license: no standard terms.
  [DJ_WALLET, "tB", "vocals", "sync"],
  // A stem that is no longer current is not exported.
  [DJ_WALLET, "tD", "bass", "personal"],
  // One stem with a standard license, one without.
  [DJ_WALLET, "tE", "drums", "personal"],
  [DJ_WALLET, "tE", "bass", "broadcast"],
];

async function seedCatalog() {
  let counter = 0;
  const baseListingId = 8_100_000n + BigInt(Date.now() % 100_000) * 100n;

  for (const track of TRACKS) {
    await prisma.release.create({
      data: {
        id: id(`${track.key}_release`),
        title: `Release ${track.key}`,
        artistId: ARTIST,
        status: "published",
        genre: "Techno",
      },
    });
    await prisma.track.create({
      data: {
        id: id(track.key),
        title: track.key === "tA" ? 'Track "A" & <Co>' : `Track ${track.key}`,
        artist: track.artist,
        releaseId: id(`${track.key}_release`),
        position: 1,
        contentStatus: "clean",
      },
    });
    for (const stem of track.stems) {
      await prisma.stem.create({
        data: {
          id: id(`${track.key}_${stem.type}`),
          trackId: id(track.key),
          type: stem.type,
          uri: `local://${track.key}-${stem.type}.mp3`,
          isCurrent: stem.current ?? true,
          audioFeatures: (stem.features ?? undefined) as never,
        },
      });
    }
  }

  for (const [buyer, trackKey, stemType, license] of PURCHASES) {
    counter += 1;
    const listingId = baseListingId + BigInt(counter);
    const listing = await prisma.stemListing.create({
      data: {
        listingId,
        stemId: id(`${trackKey}_${stemType}`),
        tokenId: listingId + 1000n,
        chainId: CHAIN_ID,
        contractAddress: MARKETPLACE,
        sellerAddress: SELLER,
        pricePerUnit: "1000000",
        amount: 3n,
        paymentToken: USDC,
        expiresAt: new Date(Date.now() + 7 * 86_400_000),
        transactionHash: hex(`list${counter}`),
        blockNumber: 1n,
        licenseType: license as never,
        status: "active",
        listedAt: new Date(),
      },
    });
    await prisma.stemPurchase.create({
      data: {
        listingId: listing.id,
        buyerAddress: buyer.toLowerCase(),
        amount: 1n,
        totalPaid: "1000000",
        royaltyPaid: "50000",
        protocolFeePaid: "100000",
        sellerReceived: "850000",
        licenseType: license as never,
        transactionHash: hex(`buy${counter}`),
        logIndex: 0,
        blockNumber: 2n,
        purchasedAt: new Date(),
      },
    });
  }
}

async function makeCrate(
  userId: string,
  trackKeys: string[],
  title: string | null = "Friday: warm-up",
): Promise<string> {
  const crate = await prisma.crate.create({
    data: { userId, title, filters: { count: 8 } as never, status: "saved" },
  });
  await prisma.crateItem.createMany({
    data: trackKeys.map((key, position) => ({ crateId: crate.id, userId, trackId: id(key), position })),
  });
  return crate.id;
}

const readTags = (bytes: Buffer): Array<{ id: string; payload: Buffer }> => {
  const tags: Array<{ id: string; payload: Buffer }> = [];
  let offset = 0;
  while (offset < bytes.length) {
    const length = bytes.readUInt32BE(offset + 4);
    tags.push({
      id: bytes.subarray(offset, offset + 4).toString("ascii"),
      payload: bytes.subarray(offset + 8, offset + 8 + length),
    });
    offset += 8 + length;
  }
  return tags;
};
const utf16be = (bytes: Buffer) => Buffer.from(bytes).swap16().toString("utf16le");

describe("CrateExportService (integration)", () => {
  let service: CrateExportService;

  beforeAll(async () => {
    for (const userId of [DJ, NO_WALLET_DJ, OTHER_DJ, ARTIST_USER]) {
      await prisma.user.create({ data: { id: userId, email: `${userId}@test.resonate` } });
    }
    await prisma.wallet.create({ data: { userId: DJ, address: DJ_WALLET, chainId: CHAIN_ID } });
    await prisma.wallet.create({ data: { userId: OTHER_DJ, address: OTHER_WALLET, chainId: CHAIN_ID } });
    await prisma.artist.create({
      data: { id: ARTIST, userId: ARTIST_USER, displayName: "Export Artist", payoutAddress: `0x${"A".repeat(40)}` },
    });
    await seedCatalog();
    service = new CrateExportService(new CrateEntitlementsService());
  });

  afterAll(async () => {
    await prisma.crate.deleteMany({ where: { userId: { in: [DJ, NO_WALLET_DJ, OTHER_DJ] } } }).catch(() => {});
    await prisma.stemPurchase
      .deleteMany({ where: { transactionHash: { startsWith: `0x${Buffer.from(TEST_PREFIX).toString("hex").slice(0, 16)}` } } })
      .catch(() => {});
    await prisma.stemListing.deleteMany({ where: { stemId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.track.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.release.deleteMany({ where: { id: { startsWith: TEST_PREFIX } } }).catch(() => {});
    await prisma.artist.deleteMany({ where: { id: ARTIST } }).catch(() => {});
    await prisma.wallet.deleteMany({ where: { userId: { in: [DJ, OTHER_DJ] } } }).catch(() => {});
    await prisma.user
      .deleteMany({ where: { id: { in: [DJ, NO_WALLET_DJ, OTHER_DJ, ARTIST_USER] } } })
      .catch(() => {});
  });

  describe("manifest", () => {
    it("lists only owned standard-license stems, in crate then stem order, and skips the rest with a reason", async () => {
      // Crate order on purpose is not the seed order.
      const crateId = await makeCrate(DJ, ["tE", "tA", "tB", "tC", "tD"]);
      const manifest = await service.getManifest(DJ, crateId);

      expect(manifest.entries.map((entry) => [entry.position, entry.trackId, entry.stemType, entry.licenseType])).toEqual([
        [0, id("tE"), "drums", "personal"],
        [1, id("tA"), "vocals", "commercial"],
        [1, id("tA"), "drums", "remix"],
      ]);
      expect(manifest.entries.map((entry) => entry.stemId)).toEqual([
        id("tE_drums"),
        id("tA_vocals"),
        id("tA_drums"),
      ]);

      expect(manifest.skipped).toEqual([
        { position: 2, trackId: id("tB"), title: "Track tB", reason: "no_export_right" },
        { position: 3, trackId: id("tC"), title: "Track tC", reason: "not_purchased" },
        { position: 4, trackId: id("tD"), title: "Track tD", reason: "not_purchased" },
      ]);
    });

    it("has the documented entry shape with the credited artist, file names and measured features", async () => {
      const crateId = await makeCrate(DJ, ["tA"]);
      const { entries } = await service.getManifest(DJ, crateId);

      expect(entries).toEqual([
        {
          position: 0,
          trackId: id("tA"),
          stemId: id("tA_vocals"),
          stemType: "vocals",
          title: 'Track "A" & <Co>',
          artistName: "Credited / Name",
          licenseType: "commercial",
          fileName: "Credited Name - Track A & Co (Vocals).mp3",
          // The mix's measured features win over the stem's own: every stem
          // of a track shares the mix's grid.
          bpm: 126,
          key: "Am",
          camelot: "8A",
          firstBeatSec: 0.25,
          hasCue: true,
        },
        {
          position: 0,
          trackId: id("tA"),
          stemId: id("tA_drums"),
          stemType: "drums",
          title: 'Track "A" & <Co>',
          artistName: "Credited / Name",
          licenseType: "remix",
          fileName: "Credited Name - Track A & Co (Drums).mp3",
          // No features of its own: the track's measured features.
          bpm: 126,
          key: "Am",
          camelot: "8A",
          firstBeatSec: 0.25,
          hasCue: true,
        },
      ]);
    });

    it("has no tempo, key or cue where nothing was measured, and falls back to the account name for the artist", async () => {
      const crateId = await makeCrate(DJ, ["tE"]);
      const { entries } = await service.getManifest(DJ, crateId);
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({
        artistName: "Export Artist",
        bpm: null,
        key: null,
        camelot: null,
        firstBeatSec: null,
        hasCue: false,
        fileName: "Export Artist - Track tE (Drums).mp3",
      });
    });

    it("explains the limits in notes, including the Serato limit and a left-out stem", async () => {
      const crateId = await makeCrate(DJ, ["tE"]);
      const { notes } = await service.getManifest(DJ, crateId);
      expect(notes.join(" ")).toMatch(/never grants a license/);
      expect(notes.join(" ")).toMatch(/Serato.*carries none of them/);
      expect(notes.join(" ")).toMatch(/1 stem has no measured tempo/);
      expect(notes.join(" ")).toMatch(/1 purchased stem is left out/);
    });

    it("ignores other people's purchases: each wallet sees only its own stems", async () => {
      const mine = await service.getManifest(DJ, await makeCrate(DJ, ["tA", "tC"]));
      expect(mine.entries.map((entry) => entry.stemType)).toEqual(["vocals", "drums"]);
      expect(mine.skipped).toEqual([
        { position: 1, trackId: id("tC"), title: "Track tC", reason: "not_purchased" },
      ]);

      const theirs = await service.getManifest(OTHER_DJ, await makeCrate(OTHER_DJ, ["tA", "tC"]));
      expect(theirs.entries.map((entry) => [entry.trackId, entry.stemType, entry.licenseType])).toEqual([
        [id("tA"), "guitar", "commercial"],
        [id("tC"), "vocals", "personal"],
      ]);
      expect(theirs.skipped).toEqual([]);
    });

    it("answers 200 with no entries when nothing is exportable", async () => {
      const crateId = await makeCrate(DJ, ["tB", "tC"]);
      await expect(service.getManifest(DJ, crateId)).resolves.toMatchObject({
        entries: [],
        skipped: [
          { position: 0, reason: "no_export_right" },
          { position: 1, reason: "not_purchased" },
        ],
      });
    });

    it("404s another user's crate and an unknown id, and 409s without a wallet", async () => {
      const crateId = await makeCrate(DJ, ["tA"]);
      await expect(service.getManifest(OTHER_DJ, crateId)).rejects.toBeInstanceOf(NotFoundException);
      await expect(service.getManifest(DJ, "missing")).rejects.toBeInstanceOf(NotFoundException);

      const noWalletCrate = await makeCrate(NO_WALLET_DJ, ["tA"]);
      await expect(service.getManifest(NO_WALLET_DJ, noWalletCrate)).rejects.toMatchObject({
        response: { code: "no_wallet" },
        status: 409,
      });
    });

    it("403s pro_required when the policy denies, before any lookup", async () => {
      const crateId = await makeCrate(DJ, ["tA"]);
      const denied = jest.spyOn(CrateEntitlementsService.prototype, "export").mockResolvedValueOnce({
        allowed: false,
        reason: "subscription_required",
        policyVersion: "crate-pro-policy/v2",
      });
      await expect(service.getManifest(DJ, crateId)).rejects.toBeInstanceOf(ForbiddenException);
      denied.mockRestore();
      // Nothing the DJ owns changed.
      await expect(service.getManifest(DJ, crateId)).resolves.toMatchObject({ entries: expect.any(Array) });
    });
  });

  describe("files", () => {
    it("generates a rekordbox XML of the manifest's entries and file names in the typed folder", async () => {
      const crateId = await makeCrate(DJ, ["tA", "tE", "tB"]);
      const manifest = await service.getManifest(DJ, crateId);
      const file = await service.exportFile(DJ, crateId, {
        format: "rekordbox",
        folder: "C:\\Users\\dj\\My Music",
      });

      expect(file.contentType).toBe("application/xml; charset=utf-8");
      expect(file.fileName).toBe("Friday warm-up.xml");
      const xml = file.body.toString("utf8");
      expect(xml.startsWith('<?xml version="1.0" encoding="UTF-8"?>')).toBe(true);
      expect(xml).toContain(`<COLLECTION Entries="${manifest.entries.length}">`);
      for (const entry of manifest.entries) {
        const encoded = encodeURIComponent(entry.fileName).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
        expect(xml).toContain(`Location="file://localhost/C:/Users/dj/My%20Music/${encoded}"`);
      }
      // The skipped line (tB) is not in the file.
      expect(xml).not.toContain("Track tB");
      // A cue only where tempo and first beat were measured (both tA stems).
      expect(xml.match(/<POSITION_MARK /g)).toHaveLength(2);
      expect(xml).toContain('Name="Friday: warm-up" KeyType="0" Entries="3"');
    });

    it("generates a Serato crate whose paths are relative to the volume", async () => {
      const crateId = await makeCrate(DJ, ["tA", "tE"]);
      const manifest = await service.getManifest(DJ, crateId);
      const file = await service.exportFile(DJ, crateId, {
        format: "serato",
        folder: "/Volumes/DJ Drive/Resonate Crates",
      });

      expect(file.contentType).toBe("application/octet-stream");
      expect(file.fileName).toBe("Friday warm-up.crate");
      const tags = readTags(file.body);
      expect(tags.map((tag) => tag.id)).toEqual(["vrsn", ...manifest.entries.map(() => "otrk")]);
      expect(utf16be(tags[0].payload)).toBe("1.0/Serato ScratchLive Crate");
      const paths = tags.slice(1).map((tag) => utf16be(readTags(tag.payload)[0].payload));
      expect(paths).toEqual(manifest.entries.map((entry) => `Resonate Crates/${entry.fileName}`));
    });

    it("names the playlist and file after a default when the crate has no title", async () => {
      const crateId = await makeCrate(DJ, ["tA"], null);
      const file = await service.exportFile(DJ, crateId, { format: "rekordbox", folder: "/Music" });
      expect(file.fileName).toBe("Resonate crate.xml");
      expect(file.body.toString("utf8")).toContain('Album="Resonate crate"');
    });

    it("409s nothing_to_export when no line has an export right, and 404/409 like the manifest", async () => {
      const crateId = await makeCrate(DJ, ["tB", "tC", "tD"]);
      await expect(
        service.exportFile(DJ, crateId, { format: "serato", folder: "/Music" }),
      ).rejects.toMatchObject({ response: { code: "nothing_to_export" }, status: 409 });
      await expect(
        service.exportFile(OTHER_DJ, crateId, { format: "serato", folder: "/Music" }),
      ).rejects.toBeInstanceOf(NotFoundException);

      const noWalletCrate = await makeCrate(NO_WALLET_DJ, ["tA"]);
      await expect(
        service.exportFile(NO_WALLET_DJ, noWalletCrate, { format: "rekordbox", folder: "/Music" }),
      ).rejects.toBeInstanceOf(ConflictException);
    });

    it("never stores or logs the folder", async () => {
      const marker = `/Users/secret_${Date.now()}_person/Music`;
      const crateId = await makeCrate(DJ, ["tA", "tE"]);
      const before = await prisma.crate.findUnique({ where: { id: crateId }, include: { items: true } });

      const logged: unknown[][] = [];
      const spies = (["log", "warn", "error", "debug", "verbose"] as const).map((level) =>
        jest.spyOn(Logger.prototype, level).mockImplementation((...args: unknown[]) => {
          logged.push(args);
        }),
      );
      const stdout = jest.spyOn(process.stdout, "write");
      const stderr = jest.spyOn(process.stderr, "write");

      try {
        const file = await service.exportFile(DJ, crateId, { format: "rekordbox", folder: marker });
        expect(file.body.toString("utf8")).toContain("secret_");
        await expect(
          service.exportFile(DJ, crateId, { format: "rekordbox", folder: `${marker}/../x` }),
        ).rejects.toMatchObject({ response: { code: "invalid_folder" } });
      } finally {
        const written = [...stdout.mock.calls, ...stderr.mock.calls].map((call) => String(call[0]));
        spies.forEach((spy) => spy.mockRestore());
        stdout.mockRestore();
        stderr.mockRestore();
        expect(JSON.stringify(logged)).not.toContain("secret_");
        expect(written.join("")).not.toContain("secret_");
      }

      const after = await prisma.crate.findUnique({ where: { id: crateId }, include: { items: true } });
      // The crate (and so everything stored for it) is untouched by exporting.
      expect(JSON.stringify(after)).toBe(JSON.stringify(before));
      expect(JSON.stringify(after)).not.toContain("secret_");
    });

    it("never changes what the DJ owns", async () => {
      const count = () =>
        prisma.stemPurchase.count({ where: { listing: { stemId: { startsWith: TEST_PREFIX } } } });
      const before = await count();
      const crateId = await makeCrate(DJ, ["tA", "tB", "tC"]);
      await service.exportFile(DJ, crateId, { format: "rekordbox", folder: "/Music" });
      await service.getManifest(DJ, crateId);
      expect(await count()).toBe(before);
    });
  });
});
