import { BadRequestException } from "@nestjs/common";
import { readFile } from "fs/promises";
import { basename, dirname, join, resolve } from "path";
import { resolveContainedPath } from "../storage/path_containment";
import { getIngestionMultipartTempRoot } from "./ingestion-multipart.config";

/**
 * The bytes of an uploaded file: the in-memory buffer, or the request-owned
 * temp file the multipart storage wrote. A path outside the request's own temp
 * directory is refused, so a forged `file.path` can never read another file.
 */
export async function readIngestionUploadBuffer(file: Express.Multer.File): Promise<Buffer> {
  if (Buffer.isBuffer(file.buffer)) return file.buffer;
  if (typeof file.path === "string" && file.path.length > 0) {
    const tempRoot = resolve(getIngestionMultipartTempRoot());
    const directory = typeof file.destination === "string"
      ? resolveContainedPath(tempRoot, file.destination)
      : null;
    const filename = typeof file.filename === "string" ? file.filename : "";
    if (
      !directory || dirname(directory) !== tempRoot ||
      !/^request-[A-Za-z0-9_-]+$/.test(basename(directory)) ||
      !/^audio-[1-9][0-9]*\.upload$/.test(filename)
    ) {
      throw new BadRequestException("Uploaded audio file has no readable content");
    }
    const ownedPath = join(directory, filename);
    if (file.path !== ownedPath) {
      throw new BadRequestException("Uploaded audio file has no readable content");
    }
    return readFile(ownedPath);
  }
  throw new BadRequestException("Uploaded audio file has no readable content");
}
