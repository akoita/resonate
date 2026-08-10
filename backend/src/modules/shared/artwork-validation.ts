import { BadRequestException } from "@nestjs/common";

export const DEFAULT_ARTWORK_MAX_BYTES = 8 * 1024 * 1024;
export const DEFAULT_ARTWORK_MAX_INPUT_PIXELS = 4096 * 4096;
export const DEFAULT_SHOWS_VISUAL_MAX_TOTAL_BYTES = 32 * 1024 * 1024;
export const ARTWORK_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;

type ArtworkMimeType = (typeof ARTWORK_MIME_TYPES)[number];

export type ArtworkUpload = {
  buffer: Buffer;
  mimetype?: string | null;
  size?: number | null;
};

export type ValidatedArtwork = {
  mimeType: ArtworkMimeType;
  width: number;
  height: number;
  encodedBytes: number;
};

type ImageDimensions = {
  mimeType: ArtworkMimeType;
  width: number;
  height: number;
};

function configuredPositiveInteger(keys: string[], fallback: number): number {
  for (const key of keys) {
    const value = process.env[key]?.trim();
    if (!value) continue;
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

export function getArtworkMaxBytes(): number {
  return configuredPositiveInteger(["RELEASE_ARTWORK_MAX_BYTES"], DEFAULT_ARTWORK_MAX_BYTES);
}

export function getArtworkMaxInputPixels(): number {
  return configuredPositiveInteger(
    ["ARTWORK_MAX_INPUT_PIXELS"],
    DEFAULT_ARTWORK_MAX_INPUT_PIXELS,
  );
}

export function getShowsVisualMaxBytes(): number {
  return configuredPositiveInteger(["SHOWS_VISUAL_MAX_BYTES"], DEFAULT_ARTWORK_MAX_BYTES);
}

export function getShowsVisualMaxTotalBytes(): number {
  return configuredPositiveInteger(
    ["SHOWS_VISUAL_MAX_TOTAL_BYTES"],
    DEFAULT_SHOWS_VISUAL_MAX_TOTAL_BYTES,
  );
}

function fail(field: string, message: string): never {
  throw new BadRequestException(`${field} ${message}`);
}

function uint24LE(buffer: Buffer, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16);
}

function parsePngDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (
    buffer.length < 24 ||
    !buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ||
    buffer.toString("ascii", 12, 16) !== "IHDR"
  ) {
    return undefined;
  }
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  return width > 0 && height > 0 ? { mimeType: "image/png", width, height } : undefined;
}

function isJpegSofMarker(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    ![0xc4, 0xc8, 0xcc].includes(marker)
  );
}

function parseJpegDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return undefined;

  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    const marker = buffer[offset++];
    if (marker === undefined || marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xd0 && marker <= 0xd7) continue;
    if (offset + 1 >= buffer.length) break;
    const segmentLength = buffer.readUInt16BE(offset);
    if (segmentLength < 2 || offset + segmentLength > buffer.length) break;
    if (isJpegSofMarker(marker) && segmentLength >= 7) {
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      if (width > 0 && height > 0) return { mimeType: "image/jpeg", width, height };
      break;
    }
    offset += segmentLength;
  }
  return undefined;
}

function parseWebpDimensions(buffer: Buffer): ImageDimensions | undefined {
  if (
    buffer.length < 20 ||
    buffer.toString("ascii", 0, 4) !== "RIFF" ||
    buffer.toString("ascii", 8, 12) !== "WEBP"
  ) {
    return undefined;
  }

  let offset = 12;
  while (offset + 8 <= buffer.length) {
    const chunkType = buffer.toString("ascii", offset, offset + 4);
    const chunkSize = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    if (dataOffset + chunkSize > buffer.length) break;

    if (chunkType === "VP8X" && chunkSize >= 10) {
      const width = uint24LE(buffer, dataOffset + 4) + 1;
      const height = uint24LE(buffer, dataOffset + 7) + 1;
      return { mimeType: "image/webp", width, height };
    }
    if (chunkType === "VP8 " && chunkSize >= 10) {
      if (
        buffer[dataOffset + 3] === 0x9d &&
        buffer[dataOffset + 4] === 0x01 &&
        buffer[dataOffset + 5] === 0x2a
      ) {
        const width = buffer.readUInt16LE(dataOffset + 6) & 0x3fff;
        const height = buffer.readUInt16LE(dataOffset + 8) & 0x3fff;
        if (width > 0 && height > 0) return { mimeType: "image/webp", width, height };
      }
    }
    if (chunkType === "VP8L" && chunkSize >= 5 && buffer[dataOffset] === 0x2f) {
      const b1 = buffer[dataOffset + 1];
      const b2 = buffer[dataOffset + 2];
      const b3 = buffer[dataOffset + 3];
      const b4 = buffer[dataOffset + 4];
      const width = 1 + (b1 | ((b2 & 0x3f) << 8));
      const height = 1 + ((b2 >> 6) | (b3 << 2) | ((b4 & 0x0f) << 10));
      if (width > 0 && height > 0) return { mimeType: "image/webp", width, height };
    }

    offset = dataOffset + chunkSize + (chunkSize % 2);
  }
  return undefined;
}

function detectImage(buffer: Buffer): ImageDimensions | undefined {
  return parsePngDimensions(buffer) ?? parseJpegDimensions(buffer) ?? parseWebpDimensions(buffer);
}

export function validateArtworkUpload(
  file: ArtworkUpload,
  options: {
    field?: string;
    maxBytes?: number;
    maxInputPixels?: number;
  } = {},
): ValidatedArtwork {
  const field = options.field ?? "Artwork";
  const buffer = file.buffer;
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) fail(field, "file is empty");

  const maxBytes = options.maxBytes ?? getArtworkMaxBytes();
  const encodedBytes = Math.max(buffer.length, file.size ?? 0);
  if (encodedBytes > maxBytes) {
    fail(field, `file must be ${Math.floor(maxBytes / (1024 * 1024))} MiB or smaller`);
  }

  const detected = detectImage(buffer);
  if (!detected) fail(field, "must be a JPEG, PNG, or WebP image with readable dimensions");

  const declaredMime = file.mimetype?.split(";", 1)[0]?.trim().toLowerCase();
  if (!declaredMime || !ARTWORK_MIME_TYPES.includes(declaredMime as ArtworkMimeType)) {
    fail(field, "must be a JPEG, PNG, or WebP image");
  }
  if (declaredMime !== detected.mimeType) {
    fail(field, "MIME type does not match its file contents");
  }

  const maxInputPixels = options.maxInputPixels ?? getArtworkMaxInputPixels();
  if (detected.width * detected.height > maxInputPixels) {
    fail(field, `dimensions must not exceed ${maxInputPixels} decoded pixels`);
  }

  return {
    mimeType: detected.mimeType,
    width: detected.width,
    height: detected.height,
    encodedBytes,
  };
}
