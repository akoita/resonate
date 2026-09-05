import { EventEmitter } from "events";
import { existsSync, promises as fs } from "fs";
import { PassThrough } from "stream";
import {
  cleanupIngestionMultipartRequest,
  getIngestionMultipartLifecycle,
  initializeIngestionMultipartRequest,
  IngestionMultipartStorage,
  sweepStaleIngestionMultipartArtifacts,
} from "../modules/ingestion/ingestion-multipart.storage";
import {
  getIngestionMultipartConfig,
  INGESTION_MULTIPART_WRITER_HIGH_WATER_MARK,
} from "../modules/ingestion/ingestion-multipart.config";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

class TestRequest extends EventEmitter {
  readableEnded = false;
  complete = true;
  destroyed = false;
  requestId = "storage-test-request";
}

function file(
  fieldname: string,
  stream: PassThrough,
  mimetype: string,
): Express.Multer.File {
  return {
    fieldname,
    originalname: fieldname === "artwork" ? "cover.png" : "track.wav",
    encoding: "7bit",
    mimetype,
    stream: stream as any,
  } as Express.Multer.File;
}

function handle(
  storage: IngestionMultipartStorage,
  request: TestRequest,
  uploaded: Express.Multer.File,
): Promise<{ info?: Partial<Express.Multer.File>; error?: Error }> {
  return new Promise((resolve) => {
    storage._handleFile(request as any, uploaded, (error, info) => {
      resolve({ error: error ?? undefined, info });
    });
  });
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

describe("IngestionMultipartStorage", () => {
  const originalTempRoot = process.env.INGESTION_MULTIPART_TEMP_DIR;
  const originalTimeout = process.env.INGESTION_MULTIPART_TIMEOUT_MS;
  const originalStaleTtl = process.env.INGESTION_MULTIPART_STALE_TTL_MS;
  const originalWriters = process.env.INGESTION_MULTIPART_MAX_ACTIVE_WRITERS;

  afterEach(async () => {
    for (const [key, value] of [
      ["INGESTION_MULTIPART_TEMP_DIR", originalTempRoot],
      ["INGESTION_MULTIPART_TIMEOUT_MS", originalTimeout],
      ["INGESTION_MULTIPART_STALE_TTL_MS", originalStaleTtl],
      ["INGESTION_MULTIPART_MAX_ACTIVE_WRITERS", originalWriters],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("spools audio to a request-owned path and removes it idempotently", async () => {
    const tempRoot = await fs.mkdtemp("/tmp/resonate-ingestion-storage-");
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempRoot;
    const request = new TestRequest();
    const storage = new IngestionMultipartStorage();
    const stream = new PassThrough();
    const uploaded = file("files", stream, "audio/wav");

    const resultPromise = handle(storage, request, uploaded);
    expect(uploaded.path).toMatch(new RegExp(`^${tempRoot}/request-[^/]+/audio-1\\.upload$`));
    stream.end(Buffer.from("audio bytes"));
    const result = await resultPromise;

    expect(result.error).toBeUndefined();
    expect(result.info?.path).toBe(uploaded.path);
    expect(await fs.readFile(uploaded.path)).toEqual(Buffer.from("audio bytes"));
    const state = getIngestionMultipartLifecycle(request)!;
    expect(state.ownedPaths.has(uploaded.path)).toBe(true);

    await Promise.all([
      cleanupIngestionMultipartRequest(request),
      cleanupIngestionMultipartRequest(request),
    ]);
    expect(existsSync(state.directory)).toBe(false);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("validates artwork before callback and aborts sibling audio growth", async () => {
    const tempRoot = await fs.mkdtemp("/tmp/resonate-ingestion-storage-");
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempRoot;
    const request = new TestRequest();
    const storage = new IngestionMultipartStorage();
    const audioStream = new PassThrough();
    const artworkStream = new PassThrough();
    const audio = file("files", audioStream, "audio/wav");
    const artwork = file("artwork", artworkStream, "image/png");

    const audioResultPromise = handle(storage, request, audio);
    const artworkResultPromise = handle(storage, request, artwork);
    audioStream.write(Buffer.alloc(64 * 1024, 7));
    artworkStream.end(Buffer.from("not an image"));
    const artworkResult = await artworkResultPromise;
    const audioResult = await audioResultPromise;
    const state = getIngestionMultipartLifecycle(request)!;

    expect(artworkResult.error?.message).toContain("must be a JPEG, PNG, or WebP image");
    expect(audioResult.error).toBeDefined();
    expect(state.terminal).toBe(true);
    expect(state.temporaryBytes).toBeLessThanOrEqual(64 * 1024 + Buffer.byteLength("not an image"));
    await cleanupIngestionMultipartRequest(request);
    expect(existsSync(state.directory)).toBe(false);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("splits oversized source chunks at the enforced writer bound before sibling rejection", async () => {
    const tempRoot = await fs.mkdtemp("/tmp/resonate-ingestion-storage-");
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempRoot;
    const request = new TestRequest();
    const storage = new IngestionMultipartStorage();
    const audioStream = new PassThrough();
    const artworkStream = new PassThrough();
    const audioResultPromise = handle(storage, request, file("files", audioStream, "audio/wav"));
    const artworkResultPromise = handle(storage, request, file("artwork", artworkStream, "image/png"));
    const state = getIngestionMultipartLifecycle(request)!;

    audioStream.write(Buffer.alloc(256 * 1024, 1));
    artworkStream.end(Buffer.from("not an image"));
    const [audioResult, artworkResult] = await Promise.all([
      audioResultPromise,
      artworkResultPromise,
    ]);

    expect(artworkResult.error?.message).toContain("must be a JPEG, PNG, or WebP image");
    expect(audioResult.error).toBeDefined();
    expect(state.maxWriteChunkBytes).toBeLessThanOrEqual(
      INGESTION_MULTIPART_WRITER_HIGH_WATER_MARK,
    );
    expect(state.terminal).toBe(true);
    const bytesAtRejection = state.temporaryBytes;
    await settle();
    expect(state.temporaryBytes).toBe(bytesAtRejection);
    await cleanupIngestionMultipartRequest(request);
    expect(existsSync(state.directory)).toBe(false);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("keeps concurrent request ownership isolated", async () => {
    const tempRoot = await fs.mkdtemp("/tmp/resonate-ingestion-storage-");
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempRoot;
    const storage = new IngestionMultipartStorage();
    const firstRequest = new TestRequest();
    const secondRequest = new TestRequest();
    const firstStream = new PassThrough();
    const secondStream = new PassThrough();
    const first = file("files", firstStream, "audio/wav");
    const second = file("files", secondStream, "audio/wav");
    const firstResult = handle(storage, firstRequest, first);
    const secondResult = handle(storage, secondRequest, second);

    firstStream.end(Buffer.from("first"));
    secondStream.end(Buffer.from("second"));
    await Promise.all([firstResult, secondResult]);
    const firstState = getIngestionMultipartLifecycle(firstRequest)!;
    const secondState = getIngestionMultipartLifecycle(secondRequest)!;

    expect(firstState.directory).not.toBe(secondState.directory);
    expect(first.path).not.toBe(second.path);
    expect(await fs.readFile(first.path)).toEqual(Buffer.from("first"));
    expect(await fs.readFile(second.path)).toEqual(Buffer.from("second"));
    await cleanupIngestionMultipartRequest(firstRequest);
    expect(existsSync(secondState.directory)).toBe(true);
    await cleanupIngestionMultipartRequest(secondRequest);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("bounds active writers with paused pending streams", async () => {
    process.env.INGESTION_MULTIPART_MAX_ACTIVE_WRITERS = "1";
    const tempRoot = await fs.mkdtemp("/tmp/resonate-ingestion-storage-");
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempRoot;
    const request = new TestRequest();
    const storage = new IngestionMultipartStorage();
    const firstStream = new PassThrough();
    const secondStream = new PassThrough();
    const first = file("files", firstStream, "audio/wav");
    const second = file("files", secondStream, "audio/wav");
    const firstResult = handle(storage, request, first);
    const secondResult = handle(storage, request, second);
    const state = getIngestionMultipartLifecycle(request)!;

    expect(state.activeWriters.size).toBe(1);
    expect(state.pendingWriters).toHaveLength(1);
    firstStream.end(Buffer.from("first"));
    await firstResult;
    secondStream.end(Buffer.from("second"));
    await secondResult;
    expect(state.activeWriters.size).toBe(0);
    await cleanupIngestionMultipartRequest(request);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("fails and cleans up on a premature request close", async () => {
    const tempRoot = await fs.mkdtemp("/tmp/resonate-ingestion-storage-");
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempRoot;
    const request = new TestRequest();
    request.complete = false;
    const storage = new IngestionMultipartStorage();
    const stream = new PassThrough();
    const resultPromise = handle(storage, request, file("files", stream, "audio/wav"));

    request.emit("close");
    const result = await resultPromise;
    const state = getIngestionMultipartLifecycle(request)!;

    expect(result.error?.message).toContain("closed before completion");
    await settle();
    expect(existsSync(state.directory)).toBe(false);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("sweeps only stale generated request directories and preserves the root and other children", async () => {
    const tempRoot = await fs.mkdtemp("/tmp/resonate-ingestion-storage-");
    const staleDirectory = `${tempRoot}/request-stale-artifact`;
    const freshDirectory = `${tempRoot}/request-fresh-artifact`;
    const unrelatedDirectory = `${tempRoot}/keep-me`;
    await fs.mkdir(staleDirectory);
    await fs.mkdir(freshDirectory);
    await fs.mkdir(unrelatedDirectory);
    await fs.writeFile(`${staleDirectory}/audio.upload`, "stale");
    const staleAt = new Date(Date.now() - 60_000);
    await fs.utimes(staleDirectory, staleAt, staleAt);

    const removed = await sweepStaleIngestionMultipartArtifacts(tempRoot, 1_000);

    expect(removed).toBe(1);
    expect(existsSync(tempRoot)).toBe(true);
    expect(existsSync(staleDirectory)).toBe(false);
    expect(existsSync(freshDirectory)).toBe(true);
    expect(existsSync(unrelatedDirectory)).toBe(true);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("does not sweep an active request directory even when its mtime is stale", async () => {
    const tempRoot = await fs.mkdtemp("/tmp/resonate-ingestion-storage-");
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempRoot;
    const request = new TestRequest();
    const state = initializeIngestionMultipartRequest(request);
    const staleAt = new Date(Date.now() - 60_000);
    await fs.utimes(state.directory, staleAt, staleAt);

    await sweepStaleIngestionMultipartArtifacts(tempRoot, 1_000);

    expect(existsSync(state.directory)).toBe(true);
    await cleanupIngestionMultipartRequest(request);
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("clamps stale cleanup TTL above the maximum live request timeout", () => {
    process.env.INGESTION_MULTIPART_TIMEOUT_MS = "3600000";
    process.env.INGESTION_MULTIPART_STALE_TTL_MS = "1";

    const config = getIngestionMultipartConfig();

    expect(config.timeoutMs).toBe(3_600_000);
    expect(config.staleTtlMs).toBeGreaterThan(config.timeoutMs);
  });
});
