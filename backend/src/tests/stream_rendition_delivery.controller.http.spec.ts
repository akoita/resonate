/**
 * Streaming renditions over HTTP (#2661): public routes return rendition
 * bytes only, answer "not ready" instead of falling back to an original, and
 * read storage in bounded chunks.
 */
import { INestApplication } from "@nestjs/common";
import request from "supertest";
import { createControllerTestApp } from "./e2e-helpers";
import { CatalogController } from "../modules/catalog/catalog.controller";
import { CatalogService, type StreamableStemRecord } from "../modules/catalog/catalog.service";
import { DiscoveryPopularityService } from "../modules/catalog/discovery-popularity.service";
import { STREAM_CHUNK_BYTES, StreamRenditionService } from "../modules/catalog/stream_rendition.service";
import { StorageProvider, type StorageRangeResult } from "../modules/storage/storage_provider";
import { parseByteRange } from "../modules/storage/byte_range";

const ORIGINAL = Buffer.from("ORIGINAL-MASTER-BYTES-".repeat(64));
const RENDITION_SIZE = 5 * STREAM_CHUNK_BYTES + 12345;
const RENDITION = Buffer.alloc(RENDITION_SIZE, 0);
for (let i = 0; i < RENDITION_SIZE; i += 1) RENDITION[i] = i % 251;

class FakeRenditionStorage extends StorageProvider {
  readonly reads: number[] = [];
  async upload(): Promise<any> {
    throw new Error("not used");
  }
  async download(): Promise<Buffer | null> {
    throw new Error("whole-object reads are not allowed on the stream path");
  }
  async delete(): Promise<void> {}
  async downloadRange(uri: string, range: string): Promise<StorageRangeResult | null> {
    if (uri !== "gs://bucket/renditions/rendition-s1.mp3") return null;
    const parsed = parseByteRange(range, RENDITION.length);
    if (!parsed) return null;
    const data = RENDITION.subarray(parsed.start, parsed.end + 1);
    this.reads.push(data.length);
    return { data, start: parsed.start, end: parsed.end, total: RENDITION.length };
  }
}

function stem(overrides: Partial<StreamableStemRecord> = {}): StreamableStemRecord {
  return {
    id: "s1",
    type: "original",
    source: null,
    isEncrypted: false,
    storageProvider: "gcs",
    streamUri: "gs://bucket/renditions/rendition-s1.mp3",
    streamMimeType: "audio/mpeg",
    ...overrides,
  };
}

const catalog = {
  resolvePublicStreamStem: jest.fn(),
  resolveTrackStreamStem: jest.fn(),
  resolveOwnerTrackRendition: jest.fn().mockResolvedValue(null),
  // The legacy paths hand back the original; a passing test never sees these bytes.
  getStemBlob: jest.fn().mockResolvedValue({ data: ORIGINAL, mimeType: "audio/wav" }),
  getTrackStream: jest.fn().mockResolvedValue({ data: ORIGINAL, mimeType: "audio/wav" }),
  getStemPreview: jest.fn().mockResolvedValue({ data: ORIGINAL, mimeType: "audio/wav" }),
};

function binary(res: any, callback: (err: Error | null, body: Buffer) => void) {
  const chunks: Buffer[] = [];
  res.on("data", (chunk: Buffer) => chunks.push(chunk));
  res.on("end", () => callback(null, Buffer.concat(chunks)));
}

describe("streaming renditions (#2661)", () => {
  let app: INestApplication;
  let storage: FakeRenditionStorage;

  beforeAll(async () => {
    storage = new FakeRenditionStorage();
    app = await createControllerTestApp(CatalogController, [
      { provide: CatalogService, useValue: catalog },
      { provide: DiscoveryPopularityService, useValue: {} },
      { provide: StorageProvider, useValue: storage },
      StreamRenditionService,
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    storage.reads.length = 0;
    catalog.getStemBlob.mockClear();
    catalog.getTrackStream.mockClear();
    catalog.getStemPreview.mockClear();
  });

  const publicRoutes = [
    { name: "track stream", url: "/catalog/releases/r1/tracks/t1/stream", resolver: "resolveTrackStreamStem" as const },
    { name: "stem blob", url: "/catalog/stems/s1/blob", resolver: "resolvePublicStreamStem" as const },
    { name: "stem preview", url: "/catalog/stems/s1/preview", resolver: "resolvePublicStreamStem" as const },
  ];

  it.each(publicRoutes)("$name serves the rendition, streamed in bounded chunks", async ({ url, resolver }) => {
    catalog[resolver].mockResolvedValue(stem());
    const res = await request(app.getHttpServer()).get(url).buffer(true).parse(binary).expect(200);
    expect(Buffer.compare(res.body, RENDITION)).toBe(0);
    expect(res.headers["content-length"]).toBe(String(RENDITION.length));
    expect(res.headers["cache-control"]).toBe("private, max-age=3600");
    expect(res.body.includes(ORIGINAL.subarray(0, 20))).toBe(false);
    // Memory does not grow with file size: no read exceeds one chunk.
    expect(Math.max(...storage.reads)).toBeLessThanOrEqual(STREAM_CHUNK_BYTES);
    expect(storage.reads.length).toBeGreaterThan(5);
  });

  it.each(publicRoutes)("$name answers 503 not ready instead of falling back to the original", async ({ url, resolver }) => {
    catalog[resolver].mockResolvedValue(stem({ streamUri: null, streamMimeType: null }));
    const res = await request(app.getHttpServer()).get(url).expect(503);
    expect(res.body).toMatchObject({ code: "rendition_not_ready" });
    expect(res.headers["retry-after"]).toBe("30");
    expect(catalog.getStemBlob).not.toHaveBeenCalled();
    expect(catalog.getTrackStream).not.toHaveBeenCalled();
    expect(catalog.getStemPreview).not.toHaveBeenCalled();
  });

  it("serves a seek as a 206 capped to one chunk", async () => {
    catalog.resolveTrackStreamStem.mockResolvedValue(stem());
    const start = 2 * STREAM_CHUNK_BYTES + 7;
    const res = await request(app.getHttpServer())
      .get("/catalog/releases/r1/tracks/t1/stream")
      .set("Range", `bytes=${start}-`)
      .buffer(true)
      .parse(binary)
      .expect(206);
    const end = start + STREAM_CHUNK_BYTES - 1;
    expect(res.headers["content-range"]).toBe(`bytes ${start}-${end}/${RENDITION.length}`);
    expect(Buffer.compare(res.body, RENDITION.subarray(start, end + 1))).toBe(0);
  });

  it("answers 416 for a range past the end", async () => {
    catalog.resolveTrackStreamStem.mockResolvedValue(stem());
    await request(app.getHttpServer())
      .get("/catalog/releases/r1/tracks/t1/stream")
      .set("Range", `bytes=${RENDITION.length + 10}-`)
      .expect(416);
  });

  it("keeps the legacy path only for local development rows without a rendition", async () => {
    catalog.resolveTrackStreamStem.mockResolvedValue(stem({ streamUri: null, storageProvider: "local" }));
    await request(app.getHttpServer()).get("/catalog/releases/r1/tracks/t1/stream").expect(200);
    expect(catalog.getTrackStream).toHaveBeenCalled();
  });

  it("leaves official stems to their lossy preview path", async () => {
    catalog.resolvePublicStreamStem.mockResolvedValue(stem({ source: "official", streamUri: null }));
    await request(app.getHttpServer()).get("/catalog/stems/s1/preview").expect(200);
    expect(catalog.getStemPreview).toHaveBeenCalled();
  });
});
