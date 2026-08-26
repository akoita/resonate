import { INestApplication } from "@nestjs/common";
import { promises as fs } from "fs";
import * as http from "http";
import { IngestionController } from "../modules/ingestion/ingestion.controller";
import { IngestionService } from "../modules/ingestion/ingestion.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

const originalTempDir = process.env.INGESTION_MULTIPART_TEMP_DIR;
const originalArtworkLimit = process.env.RELEASE_ARTWORK_MAX_BYTES;
const originalMultipartTimeout = process.env.INGESTION_MULTIPART_TIMEOUT_MS;

function multipartPart(
  boundary: string,
  fieldname: string,
  content: Buffer | string,
  options: { filename?: string; mimetype?: string } = {},
): Buffer {
  const filename = options.filename ? `; filename="${options.filename}"` : "";
  const type = options.mimetype ? `Content-Type: ${options.mimetype}\r\n` : "";
  return Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="${fieldname}"${filename}\r\n${type}\r\n`,
    ),
    Buffer.isBuffer(content) ? content : Buffer.from(content),
    Buffer.from("\r\n"),
  ]);
}

function multipartBody(
  boundary: string,
  parts: Buffer[],
): Buffer {
  return Buffer.concat([...parts, Buffer.from(`--${boundary}--\r\n`)]);
}

function postChunked(
  server: http.Server,
  body: Buffer,
  boundary: string,
  chunks = 16 * 1024,
): Promise<{ statusCode: number; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === "string") {
      reject(new Error("HTTP test server is not listening"));
      return;
    }
    const request = http.request({
      host: "127.0.0.1",
      port: address.port,
      method: "POST",
      path: "/ingestion/upload",
      headers: {
        Authorization: `Bearer ${authToken("user-1")}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
    }, (response) => {
      const chunksReceived: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunksReceived.push(chunk));
      response.on("end", () => resolve({
        statusCode: response.statusCode ?? 0,
        body: Buffer.concat(chunksReceived),
      }));
    });
    request.on("error", reject);
    for (let offset = 0; offset < body.length; offset += chunks) {
      request.write(body.subarray(offset, Math.min(body.length, offset + chunks)));
    }
    request.end();
  });
}

function openPartialChunked(
  server: http.Server,
  boundary: string,
): Promise<http.ClientRequest> {
  return new Promise((resolve, reject) => {
    const address = server.address();
    if (!address || typeof address === "string") {
      reject(new Error("HTTP test server is not listening"));
      return;
    }
    const request = http.request({
      host: "127.0.0.1",
      port: address.port,
      method: "POST",
      path: "/ingestion/upload",
      headers: {
        Authorization: `Bearer ${authToken("user-1")}`,
        "Content-Type": `multipart/form-data; boundary=${boundary}`,
      },
    });
    request.on("error", () => undefined);
    request.once("socket", () => resolve(request));
  });
}

async function listen(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
}

describe("ingestion multipart HTTP lifecycle", () => {
  let app: INestApplication;
  let tempRoot: string;
  const mockIngestionService = {
    handleFileUpload: jest.fn(),
  };

  beforeAll(async () => {
    tempRoot = await fs.mkdtemp("/tmp/resonate-ingestion-http-");
    process.env.INGESTION_MULTIPART_TEMP_DIR = tempRoot;
    app = await createControllerTestApp(IngestionController, [
      { provide: IngestionService, useValue: mockIngestionService },
    ]);
    await listen(app.getHttpServer());
  });

  afterEach(() => {
    mockIngestionService.handleFileUpload.mockReset();
    delete process.env.RELEASE_ARTWORK_MAX_BYTES;
    if (originalMultipartTimeout === undefined) delete process.env.INGESTION_MULTIPART_TIMEOUT_MS;
    else process.env.INGESTION_MULTIPART_TIMEOUT_MS = originalMultipartTimeout;
  });

  afterAll(async () => {
    if (originalTempDir === undefined) delete process.env.INGESTION_MULTIPART_TEMP_DIR;
    else process.env.INGESTION_MULTIPART_TEMP_DIR = originalTempDir;
    if (originalArtworkLimit === undefined) delete process.env.RELEASE_ARTWORK_MAX_BYTES;
    else process.env.RELEASE_ARTWORK_MAX_BYTES = originalArtworkLimit;
    if (originalMultipartTimeout === undefined) delete process.env.INGESTION_MULTIPART_TIMEOUT_MS;
    else process.env.INGESTION_MULTIPART_TIMEOUT_MS = originalMultipartTimeout;
    await app.close();
    await fs.rm(tempRoot, { recursive: true, force: true });
  });

  it("accepts a chunked audio upload without an aggregate audio ceiling", async () => {
    const boundary = `----resonate-${Date.now()}-valid`;
    const audio = Buffer.alloc(256 * 1024, 3);
    mockIngestionService.handleFileUpload.mockImplementation(async (input: any) => {
      const bytes = await fs.readFile(input.files[0].path);
      return {
        releaseId: "rel-http-valid",
        status: "processing",
        observedBytes: bytes.length,
        observedArtworkBytes: input.artwork?.buffer?.length ?? 0,
      };
    });
    const body = multipartBody(boundary, [
      multipartPart(boundary, "artistId", "artist-1"),
      multipartPart(boundary, "files", audio, {
        filename: "long-track.wav",
        mimetype: "audio/wav",
      }),
    ]);

    const response = await postChunked(app.getHttpServer(), body, boundary, 7 * 1024);

    expect(response.statusCode).toBe(201);
    expect(JSON.parse(response.body.toString())).toMatchObject({
      releaseId: "rel-http-valid",
      observedBytes: audio.length,
    });
    expect(mockIngestionService.handleFileUpload).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it("rejects invalid artwork after audio-first streaming and leaves no request artifacts", async () => {
    const boundary = `----resonate-${Date.now()}-artwork-invalid`;
    const audio = Buffer.alloc(512 * 1024, 9);
    const body = multipartBody(boundary, [
      multipartPart(boundary, "files", audio, {
        filename: "audio-first.wav",
        mimetype: "audio/wav",
      }),
      multipartPart(boundary, "artwork", "not-image", {
        filename: "cover.png",
        mimetype: "image/png",
      }),
    ]);

    const response = await postChunked(app.getHttpServer(), body, boundary, 3 * 1024);

    expect(response.statusCode).toBe(400);
    expect(mockIngestionService.handleFileUpload).not.toHaveBeenCalled();
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it("returns 413 for an artwork byte overflow without limiting audio", async () => {
    process.env.RELEASE_ARTWORK_MAX_BYTES = "32";
    const boundary = `----resonate-${Date.now()}-artwork-large`;
    const body = multipartBody(boundary, [
      multipartPart(boundary, "files", Buffer.alloc(128 * 1024, 1), {
        filename: "audio-first.wav",
        mimetype: "audio/wav",
      }),
      multipartPart(boundary, "artwork", Buffer.alloc(64, 2), {
        filename: "cover.png",
        mimetype: "image/png",
      }),
    ]);

    const response = await postChunked(app.getHttpServer(), body, boundary, 1024);

    expect(response.statusCode).toBe(413);
    expect(mockIngestionService.handleFileUpload).not.toHaveBeenCalled();
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it("cleans the request directory when Multer rejects the parts limit before the controller", async () => {
    const boundary = `----resonate-${Date.now()}-parts-limit`;
    const body = multipartBody(boundary, Array.from({ length: 26 }, (_, index) => (
      multipartPart(boundary, `field-${index}`, "value")
    )));

    const response = await postChunked(app.getHttpServer(), body, boundary, 97);

    expect(response.statusCode).toBe(400);
    expect(mockIngestionService.handleFileUpload).not.toHaveBeenCalled();
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it("cleans the request directory when Multer rejects an unexpected file field", async () => {
    const boundary = `----resonate-${Date.now()}-unexpected-field`;
    const body = multipartBody(boundary, [
      multipartPart(boundary, "unexpected", Buffer.from("not accepted"), {
        filename: "unexpected.wav",
        mimetype: "audio/wav",
      }),
    ]);

    const response = await postChunked(app.getHttpServer(), body, boundary, 31);

    expect(response.statusCode).toBe(400);
    expect(mockIngestionService.handleFileUpload).not.toHaveBeenCalled();
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it("rejects artwork-first input before later sibling audio can be processed", async () => {
    const boundary = `----resonate-${Date.now()}-artwork-first`;
    const body = multipartBody(boundary, [
      multipartPart(boundary, "artwork", "not-image", {
        filename: "cover.png",
        mimetype: "image/png",
      }),
      multipartPart(boundary, "files", Buffer.alloc(1024 * 1024, 8), {
        filename: "later.wav",
        mimetype: "audio/wav",
      }),
    ]);

    const response = await postChunked(app.getHttpServer(), body, boundary, 257);

    expect(response.statusCode).toBe(400);
    expect(mockIngestionService.handleFileUpload).not.toHaveBeenCalled();
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it("isolates concurrent valid and rejected requests", async () => {
    const validBoundary = `----resonate-${Date.now()}-concurrent-valid`;
    const rejectedBoundary = `----resonate-${Date.now()}-concurrent-rejected`;
    const validAudio = Buffer.alloc(192 * 1024, 6);
    mockIngestionService.handleFileUpload.mockImplementation(async (input: any) => ({
      releaseId: "rel-concurrent-valid",
      observedBytes: (await fs.readFile(input.files[0].path)).length,
    }));
    const validBody = multipartBody(validBoundary, [
      multipartPart(validBoundary, "artistId", "artist-valid"),
      multipartPart(validBoundary, "files", validAudio, {
        filename: "valid.wav",
        mimetype: "audio/wav",
      }),
    ]);
    const rejectedBody = multipartBody(rejectedBoundary, [
      multipartPart(rejectedBoundary, "artwork", "not-image", {
        filename: "bad.png",
        mimetype: "image/png",
      }),
      multipartPart(rejectedBoundary, "files", Buffer.alloc(768 * 1024, 2), {
        filename: "rejected.wav",
        mimetype: "audio/wav",
      }),
    ]);

    const [validResponse, rejectedResponse] = await Promise.all([
      postChunked(app.getHttpServer(), validBody, validBoundary, 509),
      postChunked(app.getHttpServer(), rejectedBody, rejectedBoundary, 509),
    ]);

    expect(validResponse.statusCode).toBe(201);
    expect(JSON.parse(validResponse.body.toString())).toMatchObject({
      releaseId: "rel-concurrent-valid",
      observedBytes: validAudio.length,
    });
    expect(rejectedResponse.statusCode).toBe(400);
    expect(mockIngestionService.handleFileUpload).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it("cleans request-owned artifacts when the client disconnects mid-file", async () => {
    const boundary = `----resonate-${Date.now()}-disconnect`;
    const request = await openPartialChunked(app.getHttpServer(), boundary);
    request.write(multipartPart(boundary, "files", Buffer.alloc(32 * 1024, 4), {
      filename: "partial.wav",
      mimetype: "audio/wav",
    }));
    request.destroy();
    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(mockIngestionService.handleFileUpload).not.toHaveBeenCalled();
    expect(await fs.readdir(tempRoot)).toEqual([]);
  });

  it("times out an incomplete multipart request and removes its artifacts", async () => {
    process.env.INGESTION_MULTIPART_TIMEOUT_MS = "1000";
    const boundary = `----resonate-${Date.now()}-timeout`;
    const request = await openPartialChunked(app.getHttpServer(), boundary);
    request.write(multipartPart(boundary, "files", Buffer.alloc(16 * 1024, 5), {
      filename: "timeout.wav",
      mimetype: "audio/wav",
    }));
    await new Promise((resolve) => setTimeout(resolve, 1_200));
    request.destroy();

    expect(mockIngestionService.handleFileUpload).not.toHaveBeenCalled();
    expect(await fs.readdir(tempRoot)).toEqual([]);
  }, 5_000);
});
