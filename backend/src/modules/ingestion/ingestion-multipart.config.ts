import { tmpdir } from "os";
import { join, parse, resolve } from "path";

export const DEFAULT_INGESTION_MULTIPART_TIMEOUT_MS = 15 * 60 * 1_000;
export const DEFAULT_INGESTION_MULTIPART_STALE_TTL_MS = 2 * 60 * 60 * 1_000;
export const DEFAULT_INGESTION_MULTIPART_MAX_ACTIVE_WRITERS = 4;
export const DEFAULT_INGESTION_MULTIPART_TEMP_DIR = join(tmpdir(), "resonate-ingestion");

// This is deliberately an implementation bound, not an upload-size policy.
// Busboy applies backpressure to each file stream and the storage engine tears
// down those streams as soon as a request fails.
export const INGESTION_MULTIPART_WRITER_HIGH_WATER_MARK = 64 * 1024;

export interface IngestionMultipartConfig {
  tempRoot: string;
  timeoutMs: number;
  staleTtlMs: number;
  maxActiveWriters: number;
  writerHighWaterMark: number;
}

const MIN_TIMEOUT_MS = 1_000;
const MAX_TIMEOUT_MS = 60 * 60 * 1_000;
const MIN_STALE_TTL_MS = MAX_TIMEOUT_MS + 1_000;
const MAX_STALE_TTL_MS = 7 * 24 * 60 * 60 * 1_000;
const MIN_ACTIVE_WRITERS = 1;
const MAX_ACTIVE_WRITERS = 20;

function configuredInteger(
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  if (!value?.trim()) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(minimum, Math.floor(parsed)));
}

/**
 * Resolve a request-owned temporary root without ever accepting a filesystem
 * root as the cleanup target. Invalid values fall back to the local default.
 */
export function getIngestionMultipartTempRoot(): string {
  const configured = process.env.INGESTION_MULTIPART_TEMP_DIR?.trim();
  const candidate = configured ? resolve(configured) : DEFAULT_INGESTION_MULTIPART_TEMP_DIR;
  const parsed = parse(candidate);

  if (candidate === parsed.root || candidate.length === 0) {
    return DEFAULT_INGESTION_MULTIPART_TEMP_DIR;
  }

  // Relative paths are resolved above so deployments can provide a simple
  // path while cleanup remains scoped to a generated child directory.
  return candidate;
}

export function getIngestionMultipartTimeoutMs(): number {
  return configuredInteger(
    process.env.INGESTION_MULTIPART_TIMEOUT_MS,
    DEFAULT_INGESTION_MULTIPART_TIMEOUT_MS,
    MIN_TIMEOUT_MS,
    MAX_TIMEOUT_MS,
  );
}

export function getIngestionMultipartStaleTtlMs(): number {
  return configuredInteger(
    process.env.INGESTION_MULTIPART_STALE_TTL_MS,
    DEFAULT_INGESTION_MULTIPART_STALE_TTL_MS,
    MIN_STALE_TTL_MS,
    MAX_STALE_TTL_MS,
  );
}

export function getIngestionMultipartMaxActiveWriters(): number {
  return configuredInteger(
    process.env.INGESTION_MULTIPART_MAX_ACTIVE_WRITERS,
    DEFAULT_INGESTION_MULTIPART_MAX_ACTIVE_WRITERS,
    MIN_ACTIVE_WRITERS,
    MAX_ACTIVE_WRITERS,
  );
}

export function getIngestionMultipartConfig(): IngestionMultipartConfig {
  return {
    tempRoot: getIngestionMultipartTempRoot(),
    timeoutMs: getIngestionMultipartTimeoutMs(),
    staleTtlMs: getIngestionMultipartStaleTtlMs(),
    maxActiveWriters: getIngestionMultipartMaxActiveWriters(),
    writerHighWaterMark: INGESTION_MULTIPART_WRITER_HIGH_WATER_MARK,
  };
}
