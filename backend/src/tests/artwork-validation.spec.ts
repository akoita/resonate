import { BadRequestException } from "@nestjs/common";
import {
  DEFAULT_ARTWORK_MAX_BYTES,
  DEFAULT_ARTWORK_MAX_INPUT_PIXELS,
  validateArtworkUpload,
} from "../modules/shared/artwork-validation";

const ONE_BY_ONE_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64",
);

function oneByOneJpeg() {
  return Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08, 0x00, 0x01, 0x00, 0x01,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ]);
}

function oneByOneWebp() {
  const buffer = Buffer.alloc(30);
  buffer.write("RIFF", 0, "ascii");
  buffer.writeUInt32LE(22, 4);
  buffer.write("WEBP", 8, "ascii");
  buffer.write("VP8X", 12, "ascii");
  buffer.writeUInt32LE(10, 16);
  return buffer;
}

describe("artwork upload validation", () => {
  it.each([
    ["image/png", ONE_BY_ONE_PNG],
    ["image/jpeg", oneByOneJpeg()],
    ["image/webp", oneByOneWebp()],
  ])("accepts %s when its magic bytes and dimensions match", (mimetype, buffer) => {
    expect(validateArtworkUpload({ buffer, mimetype })).toMatchObject({
      mimeType: mimetype,
      width: 1,
      height: 1,
      encodedBytes: buffer.length,
    });
  });

  it("rejects a client-declared MIME type that does not match the bytes", () => {
    expect(() => validateArtworkUpload({ buffer: ONE_BY_ONE_PNG, mimetype: "image/jpeg" }))
      .toThrow(new BadRequestException("Artwork MIME type does not match its file contents"));
  });

  it("rejects unsupported or undecodable image bytes", () => {
    expect(() => validateArtworkUpload({ buffer: Buffer.from("not-an-image"), mimetype: "image/png" }))
      .toThrow("Artwork must be a JPEG, PNG, or WebP image with readable dimensions");
  });

  it("rejects encoded payloads over the configured byte ceiling", () => {
    const oversized = Buffer.alloc(DEFAULT_ARTWORK_MAX_BYTES + 1);
    expect(() => validateArtworkUpload({ buffer: oversized, mimetype: "image/png" }))
      .toThrow("Artwork file must be 8 MiB or smaller");
  });

  it("rejects dimensions over the decoded pixel ceiling", () => {
    const oversized = Buffer.from(ONE_BY_ONE_PNG);
    oversized.writeUInt32BE(5000, 16);
    oversized.writeUInt32BE(4000, 20);
    expect(() => validateArtworkUpload({ buffer: oversized, mimetype: "image/png" }))
      .toThrow(`Artwork dimensions must not exceed ${DEFAULT_ARTWORK_MAX_INPUT_PIXELS} decoded pixels`);
  });

  it("uses the larger reported size when Multer metadata disagrees with the buffer", () => {
    expect(() => validateArtworkUpload({
      buffer: ONE_BY_ONE_PNG,
      mimetype: "image/png",
      size: DEFAULT_ARTWORK_MAX_BYTES + 1,
    })).toThrow("Artwork file must be 8 MiB or smaller");
  });
});
