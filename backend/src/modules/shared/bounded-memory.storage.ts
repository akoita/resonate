import { PayloadTooLargeException } from "@nestjs/common";

type UploadFileStream = {
  fieldname: string;
  stream: NodeJS.ReadableStream & {
    on(event: "data" | "end" | "error", listener: (...args: any[]) => void): NodeJS.ReadableStream;
    resume(): void;
  };
};

type RequestLike = object;

export type BoundedMemoryStorageOptions = {
  maxTotalBytes?: number;
  fieldMaxBytes?: Record<string, number>;
  label?: string;
};

const requestTotals = new WeakMap<RequestLike, number>();
const MAX_BUFFER_CHUNKS_BEFORE_COALESCE = 32;

/**
 * Memory storage with stream-time per-field and aggregate byte ceilings.
 * Unlike Multer's global fileSize limit, this can cap artwork without capping
 * the audio fields that share the ingestion multipart request.
 */
export class BoundedMemoryStorage {
  private readonly maxTotalBytes?: number;
  private readonly fieldMaxBytes: Record<string, number>;
  private readonly label: string;

  constructor(options: BoundedMemoryStorageOptions = {}) {
    this.maxTotalBytes = options.maxTotalBytes;
    this.fieldMaxBytes = options.fieldMaxBytes ?? {};
    this.label = options.label ?? "Upload";
  }

  _handleFile(
    request: RequestLike,
    file: UploadFileStream,
    callback: (error?: Error | null, info?: { buffer: Buffer; size: number }) => void,
  ) {
    const chunks: Buffer[] = [];
    const maxFieldBytes = this.fieldMaxBytes[file.fieldname];
    let fieldBytes = 0;
    let finished = false;

    const finish = (error?: Error) => {
      if (finished) return;
      finished = true;
      callback(error ?? null, error ? undefined : {
        buffer: Buffer.concat(chunks),
        size: fieldBytes,
      });
    };

    file.stream.on("data", (chunk: Buffer | Uint8Array) => {
      if (finished) return;
      const nextFieldBytes = fieldBytes + chunk.length;
      const nextTotalBytes = (requestTotals.get(request) ?? 0) + chunk.length;
      if (maxFieldBytes !== undefined && nextFieldBytes > maxFieldBytes) {
        finish(new PayloadTooLargeException(
          `${this.label} field ${file.fieldname} must be ${Math.floor(maxFieldBytes / (1024 * 1024))} MiB or smaller`,
        ));
        file.stream.resume();
        return;
      }
      if (this.maxTotalBytes !== undefined && nextTotalBytes > this.maxTotalBytes) {
        finish(new PayloadTooLargeException(
          `${this.label} request must be ${Math.floor(this.maxTotalBytes / (1024 * 1024))} MiB or smaller`,
        ));
        file.stream.resume();
        return;
      }
      fieldBytes = nextFieldBytes;
      requestTotals.set(request, nextTotalBytes);
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      if (chunks.length >= MAX_BUFFER_CHUNKS_BEFORE_COALESCE) {
        const coalesced = Buffer.concat(chunks);
        chunks.length = 0;
        chunks.push(coalesced);
      }
    });
    file.stream.on("error", (error: Error) => finish(error));
    file.stream.on("end", () => finish());
  }

  _removeFile(
    _request: RequestLike,
    file: { buffer?: Buffer },
    callback: (error?: Error | null) => void,
  ) {
    delete file.buffer;
    callback(null);
  }
}
