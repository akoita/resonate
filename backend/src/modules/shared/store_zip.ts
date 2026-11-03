import { crc32 } from "zlib";

/**
 * A minimal ZIP writer (stored, no compression) for small multi-file
 * downloads, such as an audio file with its sidecar (#2540). Audio is already
 * compressed, so storing costs nothing. Entries are written with a fixed
 * DOS timestamp so the same input always produces the same bytes.
 */
export type ZipEntry = { name: string; data: Buffer };

const DOS_TIME = 0; // 00:00:00
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
const UTF8_FLAG = 0x0800;

export function storeZip(entries: ZipEntry[]): Buffer {
  const parts: Buffer[] = [];
  const writer = new StoredZipWriter((chunk) => parts.push(chunk));
  for (const entry of entries) writer.add(entry);
  writer.finish();
  return Buffer.concat(parts);
}

/**
 * Writes a stored ZIP entry by entry (#2550): each entry's bytes are handed
 * to `write` as soon as it is added, so a large multi-file download streams
 * one file at a time instead of being buffered whole. Same bytes as
 * {@link storeZip} for the same entries.
 */
export class StoredZipWriter {
  private readonly centrals: Buffer[] = [];
  private offset = 0;
  private count = 0;

  constructor(private readonly write: (chunk: Buffer) => void) {}

  add(entry: ZipEntry): void {
    const { local, name, central } = entryHeaders(entry, this.offset);
    this.write(local);
    this.write(name);
    this.write(entry.data);
    this.centrals.push(central, name);
    this.offset += local.length + name.length + entry.data.length;
    this.count += 1;
  }

  finish(): void {
    const centralSize = this.centrals.reduce((sum, b) => sum + b.length, 0);
    if (this.offset >= 0xffffffff || this.count > 0xffff) {
      throw new Error("storeZip: archives over 4 GiB need ZIP64");
    }
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(this.count, 8);
    end.writeUInt16LE(this.count, 10);
    end.writeUInt32LE(centralSize, 12);
    end.writeUInt32LE(this.offset, 16);
    for (const chunk of this.centrals) this.write(chunk);
    this.write(end);
  }
}

function entryHeaders(
  entry: ZipEntry,
  offset: number,
): { local: Buffer; name: Buffer; central: Buffer } {
  const name = Buffer.from(entry.name, "utf8");
  const crc = crc32(entry.data) >>> 0;
  const size = entry.data.length;
  if (size >= 0xffffffff || offset >= 0xffffffff) {
    throw new Error("storeZip: entries over 4 GiB need ZIP64");
  }
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4); // version needed
  local.writeUInt16LE(UTF8_FLAG, 6);
  local.writeUInt16LE(0, 8); // stored
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(size, 18);
  local.writeUInt32LE(size, 22);
  local.writeUInt16LE(name.length, 26);
  local.writeUInt16LE(0, 28);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4); // version made by
  central.writeUInt16LE(20, 6); // version needed
  central.writeUInt16LE(UTF8_FLAG, 8);
  central.writeUInt16LE(0, 10);
  central.writeUInt16LE(DOS_TIME, 12);
  central.writeUInt16LE(DOS_DATE, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(size, 20);
  central.writeUInt32LE(size, 24);
  central.writeUInt16LE(name.length, 28);
  central.writeUInt32LE(offset, 42);
  return { local, name, central };
}
