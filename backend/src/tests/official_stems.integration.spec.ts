/**
 * Official stems (#1976, ADR-TE-7) against real Postgres, real ffmpeg, the real
 * AES encryption provider and local storage: who may upload, what is refused and
 * why, that the lossless file is stored encrypted and delivered with its own
 * Content-Type and file name, that a separated stem still gets the MP3 ones, the
 * public side doors, and the migration backfill.
 */
import { ConfigService } from "@nestjs/config";
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException, UnauthorizedException } from "@nestjs/common";
import { readFileSync } from "fs";
import { join } from "path";
import { prisma } from "../db/prisma";
import { ArtistService } from "../modules/artist/artist.service";
import { CatalogService } from "../modules/catalog/catalog.service";
import { EncryptionController } from "../modules/encryption/encryption.controller";
import { EncryptionService } from "../modules/encryption/encryption.service";
import { AesEncryptionProvider } from "../modules/encryption/providers/aes_encryption_provider";
import { OfficialStemsService } from "../modules/ingestion/official-stems.service";
import { UploadRightsRoutingService } from "../modules/rights/upload-rights-routing.service";
import { EventBus } from "../modules/shared/event_bus";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import { StemPricingService } from "../modules/pricing/stem-pricing.service";
import { PART_NAMES, flacFromWav, FFMPEG_AVAILABLE, flacHeaderBuffer, fullSong, scaled, shifted, syntheticStems, wavBuffer } from "./official_stems_fixtures";

const P = `ofst_${Date.now()}_`;
const OWNER = `${P}owner`;
const OTHER = `${P}other`;
const OWNER_ARTIST = `${P}artist`;
const RELEASE = `${P}release`;
const TRACK = `${P}track`;
const MIX_STEM = `${P}mix`;
const BLOCKED_RELEASE = `${P}release_blocked`;
const BLOCKED_TRACK = `${P}track_blocked`;
const PARTIAL_RELEASE = `${P}release_partial`;
const PARTIAL_TRACK = `${P}track_partial`;
const ALL_TRACKS = [TRACK, BLOCKED_TRACK, PARTIAL_TRACK];
const BUYER = "0x00000000000000000000000000000000000b0b01";

const stems = syntheticStems(4);
// A 20 s song of six parts with rhythms of their own: long enough for the per-part alignment check.
const song = fullSong(20, 1, 44_100);
const file = (buffer: Buffer, name: string) =>
  ({ buffer, originalname: name, mimetype: "audio/wav", size: buffer.length, fieldname: "x" }) as Express.Multer.File;
const goodPackage = () => ({
  vocals: file(wavBuffer(scaled(stems.vocals, 0.9)), "vocals.wav"),
  drums: file(wavBuffer(scaled(stems.drums, 0.9)), "drums.wav"),
  bass: file(wavBuffer(scaled(stems.bass, 0.9)), "bass.wav"),
});

describe("official stems (integration)", () => {
  const eventBus = new EventBus();
  let service: OfficialStemsService;
  let encryption: EncryptionService;
  let storage: LocalStorageProvider;
  let catalog: CatalogService;
  const createdStemIds: string[] = [];

  beforeAll(async () => {
    process.env.INTERNAL_SERVICE_KEY = process.env.INTERNAL_SERVICE_KEY || "official-stems-test-key";
    const config = new ConfigService({ ENCRYPTION_SECRET: "test-encryption-secret-for-integration" });
    storage = new LocalStorageProvider();
    encryption = new EncryptionService(new AesEncryptionProvider(config) as any, config, storage);
    catalog = new CatalogService(eventBus, encryption as any, storage, new UploadRightsRoutingService());
    const artists = { findById: (id: string) => prisma.artist.findUnique({ where: { id } }) } as unknown as ArtistService;
    service = new OfficialStemsService(storage, encryption, artists, catalog);

    for (const id of [OWNER, OTHER]) await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
    await prisma.artist.create({ data: { id: OWNER_ARTIST, userId: OWNER, displayName: "Official Test Artist", payoutAddress: BUYER } });
    for (const [releaseId, trackId, route] of [
      [RELEASE, TRACK, "STANDARD_ESCROW"],
      [BLOCKED_RELEASE, BLOCKED_TRACK, "QUARANTINED_REVIEW"],
    ] as const) {
      await prisma.release.create({
        data: { id: releaseId, artistId: OWNER_ARTIST, title: "Official stems release", status: "ready", rightsRoute: route },
      });
      await prisma.track.create({
        data: { id: trackId, releaseId, title: "Night Drive", position: 1, artist: "Official Test Artist" },
      });
    }
    await prisma.release.create({
      data: { id: PARTIAL_RELEASE, artistId: OWNER_ARTIST, title: "Partial stems release", status: "ready", rightsRoute: "STANDARD_ESCROW" },
    });
    await prisma.track.create({
      data: { id: PARTIAL_TRACK, releaseId: PARTIAL_RELEASE, title: "Long Night", position: 1, artist: "Official Test Artist" },
    });
    await prisma.stem.create({
      data: { id: `${MIX_STEM}_p`, trackId: PARTIAL_TRACK, type: "original", uri: `/catalog/stems/${MIX_STEM}_p.wav/blob`, data: wavBuffer(song.mix), mimeType: "audio/wav", durationSeconds: 20, isCurrent: true },
    });
    // The track is sold with its six separated parts, so a package of all six is a complete one.
    for (const type of PART_NAMES) {
      await prisma.stem.create({
        data: { id: `${P}partial_sep_${type}`, trackId: PARTIAL_TRACK, type, uri: `mock://${P}${type}.mp3`, mimeType: "audio/mpeg", source: "separated", separationModel: "demucs-htdemucs-6s", isCurrent: true },
      });
    }
    const mix = wavBuffer(stems.mix);
    await prisma.stem.create({
      data: { id: MIX_STEM, trackId: TRACK, type: "original", uri: `/catalog/stems/${MIX_STEM}.wav/blob`, data: mix, mimeType: "audio/wav", durationSeconds: 4, isCurrent: true },
    });
    await prisma.stem.create({
      data: { id: `${MIX_STEM}_b`, trackId: BLOCKED_TRACK, type: "original", uri: `/catalog/stems/${MIX_STEM}_b.wav/blob`, data: mix, mimeType: "audio/wav", durationSeconds: 4, isCurrent: true },
    });
  }, 60_000);

  afterAll(async () => {
    const all = await prisma.stem.findMany({ where: { trackId: { in: ALL_TRACKS } }, select: { id: true, uri: true } });
    for (const stem of all) {
      await storage.delete(stem.uri).catch(() => undefined);
    }
    await prisma.stemPurchase.deleteMany({ where: { listing: { stem: { trackId: TRACK } } } });
    await prisma.stemListing.deleteMany({ where: { stem: { trackId: TRACK } } });
    await prisma.stemNftMint.deleteMany({ where: { stem: { trackId: { in: ALL_TRACKS } } } });
    await prisma.stemPricing.deleteMany({ where: { stem: { trackId: { in: ALL_TRACKS } } } });
    await prisma.stem.deleteMany({ where: { trackId: { in: ALL_TRACKS } } });
    await prisma.track.deleteMany({ where: { id: { in: ALL_TRACKS } } });
    await prisma.release.deleteMany({ where: { id: { in: [RELEASE, BLOCKED_RELEASE, PARTIAL_RELEASE] } } });
    await prisma.artist.deleteMany({ where: { id: OWNER_ARTIST } });
    await prisma.user.deleteMany({ where: { id: { in: [OWNER, OTHER] } } });
    eventBus.destroy();
  });

  const officialStems = () =>
    prisma.stem.findMany({ where: { trackId: TRACK, source: "official" }, orderBy: [{ type: "asc" }, { id: "asc" }] });

  describe("who may upload", () => {
    it("answers 401 without a user and 403 for an account that does not manage the release", async () => {
      await expect(
        service.uploadPackage({ releaseId: RELEASE, trackId: TRACK, userId: undefined, files: goodPackage() }),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      const refusal = await service
        .uploadPackage({ releaseId: RELEASE, trackId: TRACK, userId: OTHER, files: goodPackage() })
        .catch((error) => error);
      expect(refusal).toBeInstanceOf(ForbiddenException);
      expect(refusal.getResponse()).toEqual(expect.objectContaining({ code: "official_stems_forbidden" }));
      expect(await officialStems()).toHaveLength(0);
    });

    it("answers 403 when the release's rights route takes no new stems", async () => {
      const refusal = await service
        .uploadPackage({ releaseId: BLOCKED_RELEASE, trackId: BLOCKED_TRACK, userId: OWNER, files: goodPackage() })
        .catch((error) => error);
      expect(refusal).toBeInstanceOf(ForbiddenException);
      expect(refusal.getResponse()).toEqual(expect.objectContaining({ code: "official_stems_rights_route" }));
      expect(await prisma.stem.count({ where: { trackId: BLOCKED_TRACK, source: "official" } })).toBe(0);
    });
  });

  describe("what is refused, and why", () => {
    const refusal = async (files: Record<string, Express.Multer.File>) => {
      const error = await service
        .uploadPackage({ releaseId: RELEASE, trackId: TRACK, userId: OWNER, files })
        .catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      return error.getResponse() as { code: string; message: string; issues: Array<{ code: string; message: string }> };
    };
    const noOfficialRows = async () => expect(await officialStems()).toHaveLength(0);

    it("refuses a stem of the wrong length with a readable reason", async () => {
      const longer = syntheticStems(6);
      const body = await refusal({ vocals: file(wavBuffer(longer.vocals), "vocals.wav") });
      expect(body.code).toBe("official_stems_rejected");
      expect(body.issues.map((issue) => issue.code)).toEqual(["duration_mismatch"]);
      expect(body.message).toMatch(/6\.0 s long but the published mix is 4\.0 s/);
      await noOfficialRows();
    });

    it("accepts a single part: a package does not have to add up to the mix", async () => {
      // Checked on its own, one quiet part is fine; the sum is compared with the mix only for a complete package.
      const result = await service.uploadPackage({
        releaseId: RELEASE,
        trackId: TRACK,
        userId: OWNER,
        files: { bass: file(wavBuffer(scaled(stems.bass, 0.9)), "bass.wav") },
      });
      expect(result.stems.map((stem) => stem.type)).toEqual(["bass"]);
      expect(result.complete).toBe(false);
      expect(result.summedLevel).toBeNull();
      const rows = await prisma.stem.findMany({ where: { id: { in: result.stems.map((stem) => stem.id) } } });
      for (const row of rows) await storage.delete(row.uri).catch(() => undefined);
      await prisma.stem.deleteMany({ where: { id: { in: rows.map((row) => row.id) } } });
    });

    it("refuses a wrong sample rate, a lossy codec and a file that is not audio", async () => {
      const lowRate = syntheticStems(4, 22_050);
      const rate = await refusal({ drums: file(wavBuffer(lowRate.drums, { sampleRate: 22_050 }), "drums.wav") });
      expect(rate.issues.map((issue) => issue.code)).toEqual(["unsupported_sample_rate"]);
      const lossy = await refusal({ drums: file(wavBuffer(stems.drums, { formatTag: 0x55 }), "drums.wav") });
      expect(lossy.issues.map((issue) => issue.code)).toEqual(["not_lossless"]);
      const junk = await refusal({ drums: file(Buffer.from("this is not audio"), "drums.wav") });
      expect(junk.issues.map((issue) => issue.code)).toEqual(["unreadable_audio"]);
      await noOfficialRows();
    });
  });

  describe("an accepted package", () => {
    let vocalsId: string;
    let basicBytes: Buffer;

    it("is stored as official, lossless and encrypted, and recorded with its format", async () => {
      const files = goodPackage();
      basicBytes = files.vocals.buffer;
      const result = await service.uploadPackage({ releaseId: RELEASE, trackId: TRACK, userId: OWNER, files });
      expect(result.replaced).toBe(0);
      expect(result.stems.map((stem) => stem.type).sort()).toEqual(["bass", "drums", "vocals"]);
      // This track is sold with no separated parts, so nothing says the package is complete.
      expect(result.complete).toBe(false);
      expect(result.summedLevel).toBeNull();

      const rows = await officialStems();
      expect(rows).toHaveLength(3);
      for (const row of rows) {
        createdStemIds.push(row.id);
        expect(row).toEqual(
          expect.objectContaining({
            source: "official",
            separationModel: null,
            mimeType: "audio/wav",
            isCurrent: true,
            isEncrypted: true,
          }),
        );
        expect(row.uri).toMatch(/\.wav\/blob$/);
        expect(row.durationSeconds).toBeCloseTo(4, 1);
      }
      vocalsId = rows.find((row) => row.type === "vocals")!.id;
      // What is on disk is ciphertext, not the file that was uploaded.
      const stored = await storage.download(rows[0].uri);
      expect(stored).not.toBeNull();
      expect(Buffer.compare(stored as Buffer, basicBytes)).not.toBe(0);
    });

    it("is delivered to a buyer as the lossless file, with its own Content-Type and file name", async () => {
      const stem = await prisma.stem.findUniqueOrThrow({ where: { id: vocalsId } });
      await prisma.stem.update({ where: { id: vocalsId }, data: { title: "Night Drive Vocals" } });
      const listingId = `${P}listing_official`;
      await prisma.stemListing.create({
        data: {
          id: listingId, listingId: BigInt(910001), stemId: vocalsId, tokenId: BigInt(910001), chainId: 31337,
          contractAddress: "0x0000000000000000000000000000000000000001", sellerAddress: "0x0000000000000000000000000000000000000002",
          pricePerUnit: "1", amount: BigInt(1), paymentToken: "0x0000000000000000000000000000000000000000",
          expiresAt: new Date(Date.now() + 86_400_000), transactionHash: `0x${P}l1`, blockNumber: BigInt(1), listedAt: new Date(),
        },
      });
      await prisma.stemPurchase.create({
        data: {
          listingId, buyerAddress: BUYER, amount: BigInt(1), totalPaid: "1", royaltyPaid: "0", protocolFeePaid: "0",
          sellerReceived: "1", transactionHash: `0x${P}p1`, logIndex: 0, blockNumber: BigInt(1), purchasedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // past the 14-day withdrawal period (#1776)
        },
      });
      const headers: Record<string, unknown> = {};
      const res = { set: (h: Record<string, unknown>) => Object.assign(headers, h), status: jest.fn().mockReturnThis(), send: jest.fn(), json: jest.fn() };
      const controller = new EncryptionController(encryption, { isAddressForUser: async () => true } as any);
      const body = await controller.download({ stemId: vocalsId, walletAddress: BUYER } as any, { user: { userId: "buyer" } }, res as any);
      expect(res.status).not.toHaveBeenCalled();
      expect(headers["Content-Type"]).toBe("audio/wav");
      expect(headers["Content-Disposition"]).toBe('attachment; filename="Night Drive Vocals.wav"');
      const delivered = Buffer.from((body as any).getStream ? await streamToBuffer((body as any).getStream()) : []);
      expect(Buffer.compare(delivered, basicBytes)).toBe(0);
      expect(stem.mimeType).toBe("audio/wav");
    });

    it("still delivers a separated stem as MP3 with the MP3 name", async () => {
      const mp3 = Buffer.from("ID3-fake-mp3-bytes");
      const uploaded = await storage.upload(mp3, `${P}sep.mp3`, "audio/mpeg");
      const sep = await prisma.stem.create({
        data: { id: `${P}sep`, trackId: TRACK, type: "drums", uri: uploaded.uri, mimeType: "audio/mpeg", source: "separated", separationModel: "demucs-htdemucs-6s", isCurrent: true },
      });
      const listingId = `${P}listing_sep`;
      await prisma.stemListing.create({
        data: {
          id: listingId, listingId: BigInt(910002), stemId: sep.id, tokenId: BigInt(910002), chainId: 31337,
          contractAddress: "0x0000000000000000000000000000000000000001", sellerAddress: "0x0000000000000000000000000000000000000002",
          pricePerUnit: "1", amount: BigInt(1), paymentToken: "0x0000000000000000000000000000000000000000",
          expiresAt: new Date(Date.now() + 86_400_000), transactionHash: `0x${P}l2`, blockNumber: BigInt(1), listedAt: new Date(),
        },
      });
      await prisma.stemPurchase.create({
        data: {
          listingId, buyerAddress: BUYER, amount: BigInt(1), totalPaid: "1", royaltyPaid: "0", protocolFeePaid: "0",
          sellerReceived: "1", transactionHash: `0x${P}p2`, logIndex: 0, blockNumber: BigInt(1), purchasedAt: new Date(Date.now() - 15 * 24 * 60 * 60 * 1000), // past the 14-day withdrawal period (#1776)
        },
      });
      const headers: Record<string, unknown> = {};
      const res = { set: (h: Record<string, unknown>) => Object.assign(headers, h), status: jest.fn().mockReturnThis(), send: jest.fn(), json: jest.fn() };
      const controller = new EncryptionController(encryption, { isAddressForUser: async () => true } as any);
      await controller.download({ stemId: sep.id, walletAddress: BUYER } as any, { user: { userId: "buyer" } }, res as any);
      expect(headers["Content-Type"]).toBe("audio/mpeg");
      expect(headers["Content-Disposition"]).toBe('attachment; filename="drums.mp3"');
    });

    it("closes the public side doors: no blob, and only a lossy MP3 preview", async () => {
      expect(await catalog.getStemBlob(vocalsId)).toBeNull();
      expect(await catalog.getStemBlob(vocalsId, { includeRestricted: true })).not.toBeNull();
      const preview = await catalog.getStemPreview(vocalsId);
      expect(preview.mimeType).toBe("audio/mpeg");
      expect(preview.data.length).toBeGreaterThan(1000);
      expect(Buffer.compare(preview.data, basicBytes)).not.toBe(0);
      expect(preview.data.subarray(0, 4).toString("ascii")).not.toBe("RIFF");
    });

    it("prices official and separated stems separately, with no platform floor", async () => {
      const pricing = new StemPricingService();
      const sepId = `${P}sep`;
      const priced = await pricing.batchUpdateByRelease(
        RELEASE,
        OWNER,
        { basePlayPriceUsd: 0, remixLicenseUsd: 0.5, commercialLicenseUsd: 2, floorUsd: 0, ceilingUsd: 10, listingDurationDays: null },
        "official",
      );
      expect(priced.stemIds.sort()).toEqual(createdStemIds.slice().sort());
      expect(await prisma.stemPricing.findUnique({ where: { stemId: sepId } })).toBeNull();
      const separated = await pricing.batchUpdateByRelease(
        RELEASE,
        OWNER,
        { basePlayPriceUsd: 0.05, remixLicenseUsd: 5, commercialLicenseUsd: 25, floorUsd: 0.01, ceilingUsd: 50, listingDurationDays: null },
        "separated",
      );
      expect(separated.stemIds).toEqual([sepId]);
      expect((await prisma.stemPricing.findUniqueOrThrow({ where: { stemId: vocalsId } })).remixLicenseUsd).toBe(0.5);
      expect((await pricing.getPricing(vocalsId)).source).toBe("official");
      expect((await pricing.getPricing(sepId)).source).toBe("separated");
      const batch = (await pricing.batchGetPricing([vocalsId, sepId])) as Record<string, { source: string }>;
      expect([batch[vocalsId].source, batch[sepId].source]).toEqual(["official", "separated"]);
    });

    it("replaces the previous package, retires its stems and keeps the price the artist set", async () => {
      const again = await service.uploadPackage({ releaseId: RELEASE, trackId: TRACK, userId: OWNER, files: goodPackage() });
      expect(again.replaced).toBe(3);
      const current = await officialStems().then((rows) => rows.filter((row) => row.isCurrent));
      expect(current).toHaveLength(3);
      expect(current.map((row) => row.id)).not.toContain(vocalsId);
      expect((await prisma.stem.findUniqueOrThrow({ where: { id: vocalsId } })).isCurrent).toBe(false);
      const newVocals = current.find((row) => row.type === "vocals")!;
      const carried = await prisma.stemPricing.findUnique({ where: { stemId: newVocals.id } });
      expect(carried?.remixLicenseUsd).toBe(0.5);
      current.forEach((row) => createdStemIds.push(row.id));
    });

    it("cannot be replaced once one of its stems has been minted", async () => {
      const current = (await officialStems()).filter((row) => row.isCurrent);
      await prisma.stemNftMint.create({
        data: {
          stemId: current[0].id, tokenId: BigInt(910003), chainId: 31337, contractAddress: "0x0000000000000000000000000000000000000001",
          creatorAddress: BUYER, royaltyBps: 500, remixable: true, metadataUri: "ipfs://x", transactionHash: `0x${P}mint`,
          blockNumber: BigInt(1), mintedAt: new Date(),
        },
      });
      await expect(
        service.uploadPackage({ releaseId: RELEASE, trackId: TRACK, userId: OWNER, files: goodPackage() }),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe("FLAC", () => {
    it("reads a FLAC STREAMINFO header as lossless and refuses it only on the audio checks", async () => {
      // A header with no frames cannot be decoded: it must fail as unreadable, not be stored.
      const flac = flacHeaderBuffer({ sampleRate: 44_100, channels: 2, totalSamples: 44_100 * 4 });
      const error = await service
        .uploadPackage({ releaseId: RELEASE, trackId: TRACK, userId: OWNER, files: { vocals: file(flac, "vocals.flac") } })
        .catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      expect(error.getResponse().issues.map((issue: { code: string }) => issue.code)).toEqual(["unreadable_audio"]);
    });
  });

  describe("partial packages", () => {
    const partial = (files: Record<string, Express.Multer.File>) =>
      service.uploadPackage({ releaseId: PARTIAL_RELEASE, trackId: PARTIAL_TRACK, userId: OWNER, files });
    const part = (name: (typeof PART_NAMES)[number], delay = 0, gain = 0.9) =>
      file(wavBuffer(scaled(delay ? shifted(song.parts[name], delay, 44_100) : song.parts[name], gain)), `${name}.wav`);
    const refusal = async (files: Record<string, Express.Multer.File>) => {
      const error = await partial(files).catch((e) => e);
      expect(error).toBeInstanceOf(BadRequestException);
      return error.getResponse() as { code: string; message: string; issues: Array<{ code: string; stemType?: string; message: string }> };
    };
    const rows = () =>
      prisma.stem.findMany({ where: { trackId: PARTIAL_TRACK, source: "official" }, orderBy: [{ type: "asc" }, { id: "asc" }] });
    const currentTypes = async () => (await rows()).filter((row) => row.isCurrent).map((row) => row.type);

    it("accepts one part of a track sold with six, checking only that part", async () => {
      const result = await partial({ bass: part("bass") });
      expect(result.stems.map((stem) => stem.type)).toEqual(["bass"]);
      expect(result.complete).toBe(false);
      expect(result.summedLevel).toBeNull();
      expect(result.replaced).toBe(0);
      expect(result.kept).toEqual([]);
      expect(await currentTypes()).toEqual(["bass"]);
    }, 60_000);

    it("lists every part that fails, each with its own reason", async () => {
      const body = await refusal({ vocals: part("vocals", 0.7), bass: part("bass", 0.7), piano: part("piano") });
      expect(body.code).toBe("official_stems_rejected");
      expect(body.issues.map((issue) => [issue.code, issue.stemType])).toEqual([
        ["misaligned", "vocals"],
        ["misaligned", "bass"],
      ]);
      expect(body.issues[0].message).toContain("vocals (vocals.wav)");
      expect(body.issues[0].message).toContain("0.7 s later");
      // Nothing was stored or retired by the refused package.
      expect(await currentTypes()).toEqual(["bass"]);
    }, 60_000);

    it("refuses a part that is louder than the whole mix", async () => {
      const body = await refusal({ other: file(wavBuffer(scaled(song.mix, 3)), "mixdown.wav") });
      expect(body.issues.map((issue) => issue.code)).toEqual(["part_louder_than_mix"]);
      expect(body.issues[0].stemType).toBe("other");
    }, 60_000);

    it("retires only the types it supplies, so another part stays on sale", async () => {
      const bassBefore = (await rows()).find((row) => row.type === "bass" && row.isCurrent)!;
      const added = await partial({ vocals: part("vocals") });
      expect(added.replaced).toBe(0);
      expect(added.kept).toEqual(["bass"]);
      expect(await currentTypes()).toEqual(["bass", "vocals"]);
      expect((await prisma.stem.findUniqueOrThrow({ where: { id: bassBefore.id } })).isCurrent).toBe(true);

      const vocalsBefore = (await rows()).find((row) => row.type === "vocals" && row.isCurrent)!;
      await prisma.stemPricing.create({
        data: { stemId: vocalsBefore.id, basePlayPriceUsd: 0, remixLicenseUsd: 1.25, commercialLicenseUsd: 4, floorUsd: 0, ceilingUsd: 10 },
      });
      const replaced = await partial({ vocals: part("vocals") });
      expect(replaced.replaced).toBe(1);
      expect(replaced.kept).toEqual(["bass"]);
      expect(await currentTypes()).toEqual(["bass", "vocals"]);
      expect((await prisma.stem.findUniqueOrThrow({ where: { id: vocalsBefore.id } })).isCurrent).toBe(false);
      expect((await prisma.stem.findUniqueOrThrow({ where: { id: bassBefore.id } })).isCurrent).toBe(true);
      // The price set for the retired vocals part is carried to its replacement.
      const carried = await prisma.stemPricing.findUnique({ where: { stemId: replaced.stems[0].id } });
      expect(carried?.remixLicenseUsd).toBe(1.25);
    }, 60_000);

    it("lets a part be replaced while another part of the package is minted, but not the minted one", async () => {
      const bass = (await rows()).find((row) => row.type === "bass" && row.isCurrent)!;
      await prisma.stemNftMint.create({
        data: {
          stemId: bass.id, tokenId: BigInt(910004), chainId: 31337, contractAddress: "0x0000000000000000000000000000000000000001",
          creatorAddress: BUYER, royaltyBps: 500, remixable: true, metadataUri: "ipfs://y", transactionHash: `0x${P}mint_p`,
          blockNumber: BigInt(1), mintedAt: new Date(),
        },
      });
      const vocals = await partial({ vocals: part("vocals") });
      expect(vocals.replaced).toBe(1);
      expect(vocals.kept).toEqual(["bass"]);
      const error = await partial({ bass: part("bass") }).catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: "official_stems_already_minted" }));
      expect(await currentTypes()).toEqual(["bass", "vocals"]);
    }, 90_000);

    it("compares the sum with the mix only for a complete package, and keeps the minted part out of its replacement", async () => {
      // Every part the track is sold with, one tenth of its level: each part is fine alone, together they are far too quiet.
      const quiet: Record<string, Express.Multer.File> = {};
      for (const name of PART_NAMES) quiet[name] = part(name, 0, 0.09);
      const body = await refusal(quiet);
      expect(body.issues.map((issue) => issue.code)).toEqual(["summed_level_mismatch"]);
      expect(body.issues[0].message).toContain("quieter");

      // Without the minted bass the same quiet parts are a partial package and pass.
      const { bass: _bass, ...withoutBass } = quiet;
      void _bass;
      const partialResult = await partial(withoutBass);
      expect(partialResult.complete).toBe(false);
      expect(partialResult.summedLevel).toBeNull();
      expect(partialResult.replaced).toBe(1); // the vocals part
      expect(partialResult.kept).toEqual(["bass"]);
    }, 120_000);

    it("accepts a complete, aligned package, measures its sum, and replaces all of the supplied parts", async () => {
      // Clear the minted bass so the whole set can be replaced.
      await prisma.stemNftMint.deleteMany({ where: { stem: { trackId: PARTIAL_TRACK } } });
      const full: Record<string, Express.Multer.File> = {};
      for (const name of PART_NAMES) full[name] = part(name);
      const result = await partial(full);
      expect(result.complete).toBe(true);
      expect(result.kept).toEqual([]);
      expect(result.stems.map((stem) => stem.type).sort()).toEqual([...PART_NAMES].sort());
      expect(Math.abs(result.summedLevel!.differenceDb)).toBeLessThan(1);
      expect(result.summedLevel!.envelopeCorrelation).toBeGreaterThan(0.95);
      expect(await currentTypes()).toEqual([...PART_NAMES].sort());
    }, 120_000);

    (FFMPEG_AVAILABLE ? it : it.skip)("stores a real FLAC part as FLAC and decodes it for the checks", async () => {
      const flac = flacFromWav(wavBuffer(scaled(song.parts.drums, 0.9)));
      const result = await partial({ drums: file(flac, "drums.flac") });
      expect(result.stems).toEqual([expect.objectContaining({ type: "drums", mimeType: "audio/flac", sampleRate: 44_100 })]);
      const row = await prisma.stem.findUniqueOrThrow({ where: { id: result.stems[0].id } });
      expect(row.uri).toMatch(/\.flac\/blob$/);
      expect(row.durationSeconds).toBeCloseTo(20, 1);
    }, 60_000);
  });

  describe("withdrawing a part (#2379)", () => {
    const withdrawAs = (userId: string | undefined, stemType: string) =>
      service.withdrawPart({ releaseId: PARTIAL_RELEASE, trackId: PARTIAL_TRACK, stemType, userId });
    const withdraw = (stemType: string) => withdrawAs(OWNER, stemType);
    const current = (type?: string) =>
      prisma.stem.findMany({ where: { trackId: PARTIAL_TRACK, isCurrent: true, ...(type ? { type } : {}) }, orderBy: { id: "asc" } });

    it("answers 401 without a user and 403 for an account that does not manage the release", async () => {
      await expect(withdrawAs(undefined, "piano")).rejects.toBeInstanceOf(UnauthorizedException);
      await expect(withdrawAs(OTHER, "piano")).rejects.toBeInstanceOf(ForbiddenException);
      expect((await current("piano")).filter((row) => row.source === "official")).toHaveLength(1);
    });

    it("takes the official part off sale, keeps it as history, and leaves the separated stem and other parts alone", async () => {
      const piano = (await current("piano")).find((row) => row.source === "official")!;
      const result = await withdraw("piano");
      expect(result.withdrawnStemIds).toEqual([piano.id]);
      expect(result.remaining).toEqual(PART_NAMES.filter((name) => name !== "piano").sort());
      const row = await prisma.stem.findUniqueOrThrow({ where: { id: piano.id } });
      expect(row.isCurrent).toBe(false);
      expect(row.uri).toBe(piano.uri);
      // The separated piano is still sold.
      expect((await current("piano")).map((stem) => stem.source)).toEqual(["separated"]);
    });

    it("answers 404 when there is no official part of that type on sale, and 400 for an unknown type", async () => {
      const gone = await withdraw("piano").catch((e) => e);
      expect(gone).toBeInstanceOf(NotFoundException);
      expect(gone.getResponse()).toEqual(expect.objectContaining({ code: "official_stems_part_not_found" }));
      await expect(withdraw("original")).rejects.toBeInstanceOf(BadRequestException);
    });

    it("refuses a minted part", async () => {
      const guitar = (await current("guitar")).find((row) => row.source === "official")!;
      await prisma.stemNftMint.create({
        data: {
          stemId: guitar.id, tokenId: BigInt(910005), chainId: 31337, contractAddress: "0x0000000000000000000000000000000000000001",
          creatorAddress: BUYER, royaltyBps: 500, remixable: true, metadataUri: "ipfs://z", transactionHash: `0x${P}mint_w`,
          blockNumber: BigInt(1), mintedAt: new Date(),
        },
      });
      const error = await withdraw("guitar").catch((e) => e);
      expect(error).toBeInstanceOf(ConflictException);
      expect(error.getResponse()).toEqual(expect.objectContaining({ code: "official_stems_already_minted" }));
      expect((await prisma.stem.findUniqueOrThrow({ where: { id: guitar.id } })).isCurrent).toBe(true);
    });
  });

  describe("separation results", () => {
    it("records the separation model on new separated stems and never clears official stems", async () => {
      const releaseId = `${P}release_proc`;
      const trackId = `${P}track_proc`;
      await prisma.release.create({
        data: { id: releaseId, artistId: OWNER_ARTIST, title: "Processing", status: "processing", rightsRoute: "STANDARD_ESCROW" },
      });
      await prisma.track.create({ data: { id: trackId, releaseId, title: "Processing", position: 1 } });
      await prisma.stem.createMany({
        data: [
          { id: `${P}proc_original`, trackId, type: "original", uri: "mock://original", isCurrent: true },
          { id: `${P}proc_official`, trackId, type: "vocals", uri: "mock://official.wav", mimeType: "audio/wav", source: "official", isCurrent: true },
          { id: `${P}proc_stale`, trackId, type: "bass", uri: "mock://stale", source: "separated", isCurrent: true },
        ],
      });
      catalog.onModuleInit();
      eventBus.publish({
        eventName: "stems.processed",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        releaseId,
        artistId: OWNER_ARTIST,
        modelVersion: "demucs-htdemucs-6s",
        tracks: [{
          id: trackId, title: "Processing", position: 1,
          stems: [
            { id: `${P}proc_original`, type: "original", uri: "mock://original", storageProvider: "local" },
            { id: `${P}proc_drums`, type: "drums", uri: "mock://drums.mp3", mimeType: "audio/mpeg", storageProvider: "local" },
          ],
        }],
      } as any);
      const deadline = Date.now() + 5_000;
      while (Date.now() < deadline) {
        const release = await prisma.release.findUnique({ where: { id: releaseId }, select: { status: true } });
        if (release?.status === "ready") break;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      const rows = await prisma.stem.findMany({ where: { trackId } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(`${P}proc_drums`)).toEqual(expect.objectContaining({ source: "separated", separationModel: "demucs-htdemucs-6s" }));
      expect(byId.get(`${P}proc_original`)).toEqual(expect.objectContaining({ source: null, separationModel: null }));
      expect(byId.get(`${P}proc_official`)).toEqual(expect.objectContaining({ source: "official" }));
      // The stale separated leftover of a crashed run is still cleaned up.
      expect(byId.has(`${P}proc_stale`)).toBe(false);
      await prisma.stem.deleteMany({ where: { trackId } });
      await prisma.track.delete({ where: { id: trackId } });
      await prisma.release.delete({ where: { id: releaseId } });
    });
  });

  describe("migration backfill", () => {
    it("marks separated stems with the model and leaves original and master rows without a source", async () => {
      const sql = readFileSync(
        join(__dirname, "..", "..", "prisma", "migrations", "20261025150000_stem_source_official", "migration.sql"),
        "utf8",
      );
      const update = sql.slice(sql.indexOf("UPDATE"), sql.indexOf(";", sql.indexOf("UPDATE")) + 1);
      expect(update).toContain('UPDATE "Stem"');
      const legacy = [
        { id: `${P}legacy_drums`, type: "drums" },
        { id: `${P}legacy_vocals`, type: "VOCALS" },
        { id: `${P}legacy_original`, type: "original" },
        { id: `${P}legacy_master`, type: "master" },
      ];
      for (const row of legacy) {
        await prisma.stem.create({ data: { id: row.id, trackId: BLOCKED_TRACK, type: row.type, uri: `/x/${row.id}`, isCurrent: false } });
      }
      // The migration runs over the whole table; only the rows seeded here are asserted.
      await prisma.$executeRawUnsafe(update);
      const rows = await prisma.stem.findMany({ where: { id: { in: legacy.map((row) => row.id) } } });
      const byId = new Map(rows.map((row) => [row.id, row]));
      expect(byId.get(`${P}legacy_drums`)).toEqual(expect.objectContaining({ source: "separated", separationModel: "demucs-htdemucs-6s" }));
      expect(byId.get(`${P}legacy_vocals`)).toEqual(expect.objectContaining({ source: "separated" }));
      expect(byId.get(`${P}legacy_original`)).toEqual(expect.objectContaining({ source: null, separationModel: null }));
      expect(byId.get(`${P}legacy_master`)).toEqual(expect.objectContaining({ source: null, separationModel: null }));
      // The original mix of the seeded track was never touched.
      expect((await prisma.stem.findUniqueOrThrow({ where: { id: MIX_STEM } })).source).toBeNull();
    });
  });
});

async function streamToBuffer(stream: NodeJS.ReadableStream): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk as Buffer));
  return Buffer.concat(chunks);
}
