import { PayloadTooLargeException, RequestTimeoutException } from "@nestjs/common";
import { createWriteStream, mkdirSync, mkdtempSync, promises as fs } from "fs";
import { join, relative, sep } from "path";
import { Readable, Writable } from "stream";
import { getArtworkMaxBytes, validateArtworkUpload } from "../shared/artwork-validation";
import { writeStructuredLog } from "../shared/structured_logging";
import {
  getIngestionMultipartConfig,
  type IngestionMultipartConfig,
} from "./ingestion-multipart.config";

type RequestLike = {
  on?: (event: string, listener: (...args: any[]) => void) => RequestLike;
  readableEnded?: boolean;
  complete?: boolean;
  destroyed?: boolean;
  requestId?: string;
  destroy?: (error?: Error) => void;
};

type StorageCallback = (
  error?: Error | null,
  info?: Partial<Express.Multer.File>,
) => void;

type WriterKind = "audio" | "artwork";

type UploadWriter = {
  kind: WriterKind;
  stream: Readable;
  file: Express.Multer.File;
  mimetype: string;
  callback: StorageCallback;
  bytes: number;
  chunks: Buffer[];
  output?: Writable;
  destination?: Writable;
  outputPath?: string;
  started: boolean;
  finished: boolean;
};

export type IngestionMultipartLifecycle = {
  request: RequestLike;
  directory: string;
  ownedPaths: Set<string>;
  activeStreams: Set<Readable>;
  activeWriters: Set<UploadWriter>;
  pendingWriters: UploadWriter[];
  activeCallbacks: Set<StorageCallback>;
  receivedBytes: number;
  temporaryBytes: number;
  timer?: NodeJS.Timeout;
  terminal: boolean;
  cleanupStarted: boolean;
  cleanupPromise?: Promise<void>;
  failure?: Error;
  config: IngestionMultipartConfig;
  requestId?: string;
  maxWriteChunkBytes: number;
};

const lifecycles = new WeakMap<object, IngestionMultipartLifecycle>();
const activeDirectories = new Set<string>();
const GENERATED_REQUEST_DIRECTORY = /^request-[A-Za-z0-9_-]+$/;

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(value ? String(value) : fallback);
}

function errorCode(error: unknown): string | undefined {
  const code = (error as { code?: unknown } | undefined)?.code;
  return typeof code === "string" && code.length <= 64 ? code : undefined;
}

/**
 * A disk boundary that never hands more than `chunkLimit` bytes to the
 * underlying file stream. Busboy and Readable streams may provide a chunk
 * larger than a WriteStream highWaterMark; the highWaterMark alone does not
 * split that chunk. This sink does, while checking the request terminal state
 * between each bounded write.
 */
class BoundedDiskWritable extends Writable {
  constructor(
    private readonly destination: Writable,
    private readonly chunkLimit: number,
    private readonly shouldContinue: () => boolean,
    private readonly onSlice: (bytes: number) => void,
  ) {
    super({ highWaterMark: chunkLimit });
    destination.once("error", (error: Error) => this.destroy(error));
  }

  override _write(
    chunk: Buffer | Uint8Array,
    encoding: BufferEncoding,
    callback: (error?: Error | null) => void,
  ): void {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk.buffer as ArrayBuffer, chunk.byteOffset, chunk.byteLength);
    let offset = 0;
    let settled = false;
    const finish = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      callback(error);
    };
    const writeNext = () => {
      if (!this.shouldContinue()) {
        finish(new Error("Multipart request has ended"));
        return;
      }
      if (offset >= buffer.length) {
        finish();
        return;
      }

      const end = Math.min(offset + this.chunkLimit, buffer.length);
      const slice = buffer.subarray(offset, end);
      offset = end;
      this.onSlice(slice.length);
      try {
        this.destination.write(slice, (error?: Error | null) => {
          if (error) {
            finish(error);
            return;
          }
          writeNext();
        });
      } catch (error) {
        finish(asError(error, "Could not write multipart artifact"));
      }
    };

    writeNext();
  }

  override _final(callback: (error?: Error | null) => void): void {
    if (!this.shouldContinue()) {
      callback(new Error("Multipart request has ended"));
      return;
    }
    try {
      this.destination.end((error?: Error | null) => callback(error));
    } catch (error) {
      callback(asError(error, "Could not finish multipart artifact"));
    }
  }

  override _destroy(error: Error | null, callback: (error?: Error | null) => void): void {
    try {
      this.destination.destroy(error ?? undefined);
    } finally {
      callback(error);
    }
  }
}

function logMultipartEvent(
  level: "warn" | "error" | "info",
  event: string,
  message: string,
  state: IngestionMultipartLifecycle,
  extra: Record<string, unknown> = {},
): void {
  writeStructuredLog({
    level,
    event,
    message,
    ...(state.requestId ? { requestId: state.requestId } : {}),
    receivedBytes: state.receivedBytes,
    temporaryBytes: state.temporaryBytes,
    activeWriterCount: state.activeWriters.size,
    ...extra,
  });
}

function isPrematureClose(request: RequestLike): boolean {
  return !request.readableEnded && !request.complete;
}

function isContainedPath(directory: string, candidate: string): boolean {
  const child = relative(directory, candidate);
  return child !== "" && child !== ".." && !child.startsWith(`..${sep}`);
}

function safeCallback(callback: StorageCallback, error?: Error | null, info?: Partial<Express.Multer.File>): void {
  try {
    callback(error ?? null, error ? undefined : info);
  } catch {
    // Multer owns callback error propagation. A callback that throws must not
    // prevent the request lifecycle from reaching its cleanup path.
  }
}

function deliverCallback(
  state: IngestionMultipartLifecycle,
  callback: StorageCallback,
  error?: Error | null,
  info?: Partial<Express.Multer.File>,
): void {
  const deliver = () => safeCallback(callback, error, info);
  if (error && state.cleanupPromise) {
    void state.cleanupPromise.then(deliver, deliver);
    return;
  }
  deliver();
}

function destroyStream(stream: Readable, error?: Error): void {
  try {
    if (typeof stream.destroy === "function") {
      stream.destroy(error);
    } else {
      stream.resume();
    }
  } catch {
    // The request failure is already terminal; cleanup below remains best effort.
  }
}

function destroyOutput(output: Writable | undefined, error?: Error): void {
  if (!output) return;
  try {
    output.destroy(error);
  } catch {
    // The stream may already have closed while the request was being aborted.
  }
}

function destroyWriterOutput(writer: UploadWriter, error?: Error): void {
  destroyOutput(writer.output, error);
  if (writer.destination && writer.destination !== writer.output) {
    destroyOutput(writer.destination, error);
  }
}

function abortWriter(
  state: IngestionMultipartLifecycle,
  writer: UploadWriter,
  error: Error,
): void {
  if (writer.finished) return;
  writer.finished = true;
  state.activeWriters.delete(writer);
  state.activeStreams.delete(writer.stream);
  state.activeCallbacks.delete(writer.callback);
  destroyStream(writer.stream, error);
  destroyWriterOutput(writer, error);
  deliverCallback(state, writer.callback, error);
}

async function removeRequestDirectory(state: IngestionMultipartLifecycle): Promise<void> {
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = undefined;
  }

  try {
    await fs.rm(state.directory, { recursive: true, force: true });
    state.ownedPaths.clear();
  } catch (error) {
    logMultipartEvent(
      "error",
      "ingestion.multipart.cleanup_failed",
      "Failed to remove request-owned multipart artifacts",
      state,
      { errorCode: errorCode(error) },
    );
  } finally {
    activeDirectories.delete(state.directory);
  }
}

function cleanupState(state: IngestionMultipartLifecycle): Promise<void> {
  if (!state.cleanupPromise) {
    let resolveCleanup!: () => void;
    state.cleanupPromise = new Promise<void>((resolve) => {
      resolveCleanup = resolve;
    });
    state.cleanupStarted = true;
    state.terminal = true;
    const cleanupError = state.failure ?? new Error("Multipart request cleanup");
    // Mark the lifecycle terminal and destroy every stream/output before
    // recursive removal starts. Multer callbacks wait on this promise, so no
    // callback can race the directory removal.
    for (const writer of [...state.pendingWriters]) {
      abortWriter(state, writer, cleanupError);
    }
    state.pendingWriters.length = 0;
    for (const writer of [...state.activeWriters]) {
      abortWriter(state, writer, cleanupError);
    }
    void removeRequestDirectory(state).then(resolveCleanup, resolveCleanup);
  }
  return state.cleanupPromise;
}

function failRequest(
  state: IngestionMultipartLifecycle,
  error: Error,
  reason: string,
): void {
  if (state.terminal) return;
  state.terminal = true;
  state.failure = error;
  const event = reason === "request_timeout"
    ? "ingestion.multipart.timeout"
    : reason === "request_aborted" || reason === "request_closed" || reason === "request_error"
      ? "ingestion.multipart.disconnected"
      : "ingestion.multipart.rejected";
  logMultipartEvent(
    "warn",
    event,
    "Multipart ingestion request rejected",
    state,
    { reason, errorCode: errorCode(error) },
  );

  void cleanupState(state);
  if (reason === "request_timeout") {
    const closeRequest = () => {
      try {
        state.request.destroy?.();
      } catch {
        // The request may already have been disconnected while timing out.
      }
    };
    if (state.cleanupPromise) void state.cleanupPromise.then(closeRequest, closeRequest);
    else closeRequest();
  }
}

/**
 * Remove only stale, generated request directories. The configured root and
 * every non-generated child are deliberately outside this sweep's target set.
 */
export async function sweepStaleIngestionMultipartArtifacts(
  tempRoot = getIngestionMultipartConfig().tempRoot,
  staleTtlMs = getIngestionMultipartConfig().staleTtlMs,
): Promise<number> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await fs.readdir(tempRoot, { withFileTypes: true });
  } catch (error) {
    if (errorCode(error) === "ENOENT") return 0;
    writeStructuredLog({
      level: "error",
      event: "ingestion.multipart.cleanup_failed",
      message: "Failed to inspect the multipart temporary root",
      errorCode: errorCode(error),
    });
    return 0;
  }

  const cutoff = Date.now() - staleTtlMs;
  let removed = 0;
  for (const entry of entries) {
    if (!entry.isDirectory() || !GENERATED_REQUEST_DIRECTORY.test(entry.name)) continue;
    const directory = join(tempRoot, entry.name);
    if (activeDirectories.has(directory)) continue;

    try {
      const stats = await fs.stat(directory);
      if (stats.mtimeMs >= cutoff) continue;
      await fs.rm(directory, { recursive: true, force: true });
      removed += 1;
    } catch (error) {
      if (errorCode(error) === "ENOENT") continue;
      writeStructuredLog({
        level: "error",
        event: "ingestion.multipart.cleanup_failed",
        message: "Failed to remove a stale multipart request directory",
        errorCode: errorCode(error),
      });
    }
  }
  return removed;
}

function createLifecycle(request: RequestLike): IngestionMultipartLifecycle {
  const config = getIngestionMultipartConfig();
  mkdirSync(config.tempRoot, { recursive: true });
  const directory = mkdtempSync(join(config.tempRoot, "request-"));
  activeDirectories.add(directory);
  const state: IngestionMultipartLifecycle = {
    request,
    directory,
    ownedPaths: new Set(),
    activeStreams: new Set(),
    activeWriters: new Set(),
    pendingWriters: [],
    activeCallbacks: new Set(),
    receivedBytes: 0,
    temporaryBytes: 0,
    terminal: false,
    cleanupStarted: false,
    config,
    requestId: typeof request.requestId === "string" ? request.requestId : undefined,
    maxWriteChunkBytes: 0,
  };

  const failFromRequest = (error: Error, reason: string) => failRequest(state, error, reason);
  request.on?.("aborted", () => {
    failFromRequest(new Error("Multipart request aborted"), "request_aborted");
  });
  request.on?.("error", (error: unknown) => {
    failFromRequest(asError(error, "Multipart request error"), "request_error");
  });
  request.on?.("close", () => {
    if (isPrematureClose(request)) {
      failFromRequest(new Error("Multipart request closed before completion"), "request_closed");
    }
  });

  state.timer = setTimeout(() => {
    failFromRequest(
      new RequestTimeoutException("Ingestion multipart upload timed out"),
      "request_timeout",
    );
  }, config.timeoutMs);
  state.timer.unref?.();
  void sweepStaleIngestionMultipartArtifacts(config.tempRoot, config.staleTtlMs);
  return state;
}

export function getIngestionMultipartLifecycle(
  request: object,
): IngestionMultipartLifecycle | undefined {
  return lifecycles.get(request);
}

export function initializeIngestionMultipartRequest(
  request: RequestLike,
): IngestionMultipartLifecycle {
  const existing = lifecycles.get(request);
  if (existing) return existing;
  const state = createLifecycle(request);
  lifecycles.set(request, state);
  return state;
}

export function cleanupIngestionMultipartRequest(request: object): Promise<void> {
  const state = lifecycles.get(request);
  if (!state) return Promise.resolve();
  state.terminal = true;
  return cleanupState(state);
}

export class IngestionMultipartStorage {
  private getOrCreateLifecycle(request: RequestLike): IngestionMultipartLifecycle {
    return initializeIngestionMultipartRequest(request);
  }

  _handleFile(
    request: Express.Request,
    file: Express.Multer.File,
    callback: StorageCallback,
  ): void {
    let state: IngestionMultipartLifecycle;
    try {
      state = this.getOrCreateLifecycle(request as RequestLike);
    } catch (error) {
      safeCallback(callback, asError(error, "Could not create multipart temporary directory"));
      return;
    }

    if (state.terminal) {
      safeCallback(callback, state.failure ?? new Error("Multipart request has ended"));
      return;
    }

    const stream = file.stream as unknown as Readable;
    const writer: UploadWriter = {
      kind: file.fieldname === "artwork" ? "artwork" : "audio",
      stream,
      file,
      mimetype: file.mimetype,
      callback,
      bytes: 0,
      chunks: [],
      started: false,
      finished: false,
    };
    state.activeCallbacks.add(callback);
    state.pendingWriters.push(writer);
    // A queued stream has not received the storage engine's normal read/error
    // listeners yet. Keep an error listener attached so a queued read failure
    // or sibling rejection cannot surface an unhandled error.
    stream.on("error", (error: Error) => {
      if (writer.started || writer.finished) return;
      writer.finished = true;
      const index = state.pendingWriters.indexOf(writer);
      if (index >= 0) state.pendingWriters.splice(index, 1);
      state.activeCallbacks.delete(writer.callback);
      const failure = asError(error, "Multipart stream read failed");
      failRequest(state, failure, "multipart_read_error");
      deliverCallback(state, writer.callback, failure);
    });
    stream.pause();
    this.startAvailableWriters(state);
  }

  _removeFile(
    request: Express.Request,
    file: Express.Multer.File,
    callback: (error: Error | null) => void,
  ): void {
    const state = lifecycles.get(request);
    const candidate = typeof file.path === "string" ? file.path : undefined;
    if (
      !state ||
      !candidate ||
      !state.ownedPaths.has(candidate) ||
      !isContainedPath(state.directory, candidate)
    ) {
      callback(null);
      return;
    }

    state.ownedPaths.delete(candidate);
    fs.unlink(candidate)
      .catch((error: unknown) => {
        if ((error as { code?: unknown })?.code !== "ENOENT") throw error;
      })
      .then(() => callback(null))
      .catch((error: unknown) => {
        const failure = asError(error, "Could not remove multipart artifact");
        if (state) {
          logMultipartEvent(
            "error",
            "ingestion.multipart.cleanup_failed",
            "Failed to remove a request-owned multipart artifact",
            state,
            { errorCode: errorCode(error) },
          );
        }
        callback(failure);
      });
  }

  private startAvailableWriters(state: IngestionMultipartLifecycle): void {
    while (
      !state.terminal &&
      state.activeWriters.size < state.config.maxActiveWriters &&
      state.pendingWriters.length > 0
    ) {
      const writer = state.pendingWriters.shift()!;
      if (writer.finished) continue;
      writer.started = true;
      state.activeWriters.add(writer);
      state.activeStreams.add(writer.stream);
      if (writer.kind === "artwork") {
        this.startArtworkWriter(state, writer);
      } else {
        this.startAudioWriter(state, writer);
      }
    }
  }

  private completeWriter(
    state: IngestionMultipartLifecycle,
    writer: UploadWriter,
    error?: Error,
    info?: Partial<Express.Multer.File>,
    reason = "storage_error",
  ): void {
    if (writer.finished) return;
    writer.finished = true;
    state.activeWriters.delete(writer);
    state.activeStreams.delete(writer.stream);
    state.activeCallbacks.delete(writer.callback);

    if (error) {
      destroyStream(writer.stream, error);
      destroyWriterOutput(writer, error);
      if (!state.terminal) failRequest(state, error, reason);
      deliverCallback(state, writer.callback, error);
    } else if (!state.terminal) {
      safeCallback(writer.callback, null, info);
    } else {
      deliverCallback(state, writer.callback, state.failure ?? new Error("Multipart request has ended"));
    }

    this.startAvailableWriters(state);
  }

  private startArtworkWriter(state: IngestionMultipartLifecycle, writer: UploadWriter): void {
    const maxBytes = getArtworkMaxBytes();
    const onData = (chunk: Buffer | Uint8Array) => {
      if (writer.finished || state.terminal) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const nextBytes = writer.bytes + buffer.length;
      state.receivedBytes += buffer.length;
      if (nextBytes > maxBytes) {
        this.completeWriter(
          state,
          writer,
          new PayloadTooLargeException(
            `Artwork file must be ${Math.floor(maxBytes / (1024 * 1024))} MiB or smaller`,
          ),
          undefined,
          "artwork_too_large",
        );
        destroyStream(writer.stream, state.failure);
        return;
      }
      writer.bytes = nextBytes;
      state.temporaryBytes += buffer.length;
      writer.chunks.push(buffer);
    };

    writer.stream.on("data", onData);
    writer.stream.once("error", (error: Error) => {
      this.completeWriter(state, writer, error, undefined, "artwork_read_error");
    });
    writer.stream.once("end", () => {
      if (writer.finished || state.terminal) return;
      const buffer = Buffer.concat(writer.chunks, writer.bytes);
      try {
        validateArtworkUpload(
          { buffer, mimetype: writer.mimetype, size: writer.bytes },
          { field: "Artwork", maxBytes },
        );
      } catch (error) {
        this.completeWriter(
          state,
          writer,
          asError(error, "Artwork validation failed"),
          undefined,
          "artwork_rejected",
        );
        return;
      }
      this.completeWriter(state, writer, undefined, { buffer, size: writer.bytes });
    });

    writer.stream.resume();
  }

  private startAudioWriter(state: IngestionMultipartLifecycle, writer: UploadWriter): void {
    const filename = `audio-${state.ownedPaths.size + 1}.upload`;
    const outputPath = join(state.directory, filename);
    writer.outputPath = outputPath;
    state.ownedPaths.add(outputPath);

    // Expose path before piping. Multer can now remove this file even if a
    // request fails while the stream is still active.
    writer.file.destination = state.directory;
    writer.file.filename = filename;
    writer.file.path = outputPath;

    try {
      mkdirSync(state.directory, { recursive: true });
      const destination = createWriteStream(outputPath, {
        flags: "wx",
        highWaterMark: state.config.writerHighWaterMark,
      });
      const output = new BoundedDiskWritable(
        destination,
        state.config.writerHighWaterMark,
        () => !state.terminal && !writer.finished,
        (bytes) => {
          state.maxWriteChunkBytes = Math.max(state.maxWriteChunkBytes, bytes);
        },
      );
      writer.output = output;
      writer.destination = destination;

      writer.stream.on("data", (chunk: Buffer | Uint8Array) => {
        if (writer.finished || state.terminal) return;
        const length = chunk.length;
        writer.bytes += length;
        state.receivedBytes += length;
        state.temporaryBytes += length;
      });
      writer.stream.once("error", (error: Error) => {
        this.completeWriter(state, writer, error, undefined, "audio_read_error");
      });
      output.once("error", (error: Error) => {
        this.completeWriter(state, writer, error, undefined, "audio_write_error");
      });
      output.once("finish", () => {
        this.completeWriter(state, writer, undefined, {
          destination: state.directory,
          filename,
          path: outputPath,
          size: writer.bytes,
        });
      });

      writer.stream.pipe(output);
    } catch (error) {
      this.completeWriter(
        state,
        writer,
        asError(error, "Could not spool audio upload"),
        undefined,
        "audio_write_error",
      );
    }
  }
}
