/**
 * Remix watermark false-positive run (#2614, docs/rfc/remix-watermarking.md).
 *
 * Runs the mark detector over audio that was never marked and reports any
 * decoded payload that equals a stored token. Read-only: it downloads audio
 * and reads the token table, and writes nothing.
 *
 * Usage (any context with DATABASE_URL, the storage settings and the
 * REMIX_WATERMARK_* detection variables of the backend):
 *
 *   npm run remix:watermark-false-positives -- --catalog 1000
 *   npm run remix:watermark-false-positives -- --list files.txt --depth full
 *
 *   --catalog <n>   check the full mix of up to n catalog tracks that are not
 *                   remix releases (a published remix carries a mark, so it
 *                   would be a true match, not a false one)
 *   --list <file>   one entry per line: a local audio file path, or a storage
 *                   URI the configured storage provider can read
 *   --depth <d>     plain | speed (default; both quick stages) | full (adds
 *                   the pitch/tempo search, about a minute or more per clip)
 *
 * `storedTokens` in the report is the size of the token table the payloads
 * were compared with; with none stored the run proves nothing.
 *
 * Prints a JSON report (counts and labels, never a token) and exits 1 when a
 * payload equalled a stored token, 2 on a usage or configuration error.
 */
import { ConfigService } from "@nestjs/config";
import { existsSync, readFileSync } from "fs";
import { prisma } from "../db/prisma";
import { remixWatermarkDetectorFromEnv } from "../modules/remix/remix-watermark-detect";
import {
  runRemixWatermarkFalsePositiveCheck,
  type FalsePositiveRunDepth,
  type FalsePositiveRunEntry,
} from "../modules/remix/remix-watermark-false-positive-run";
import { GcsStorageProvider } from "../modules/storage/gcs_storage_provider";
import { LighthouseStorageProvider } from "../modules/storage/lighthouse_storage_provider";
import { LocalStorageProvider } from "../modules/storage/local_storage_provider";
import type { StorageProvider } from "../modules/storage/storage_provider";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

/** Mirrors the choice in `storage.module.ts`. */
function storageFromEnv(): StorageProvider {
  const config = new ConfigService();
  const provider = config.get<string>("STORAGE_PROVIDER", "local");
  if (provider === "gcs") return new GcsStorageProvider(config);
  if (provider === "ipfs" || provider === "filecoin") return new LighthouseStorageProvider(config);
  return new LocalStorageProvider();
}

async function main(): Promise<number> {
  const catalogRaw = arg("catalog");
  const listPath = arg("list");
  const depth = (arg("depth") ?? "speed") as FalsePositiveRunDepth;
  if ((!catalogRaw && !listPath) || !["plain", "speed", "full"].includes(depth)) {
    console.error(
      "Usage: npm run remix:watermark-false-positives -- (--catalog <n> | --list <file>) [--depth plain|speed|full]",
    );
    return 2;
  }
  const detector = remixWatermarkDetectorFromEnv();
  if (!detector) {
    console.error("No remix watermark key is configured, so there is nothing to detect with.");
    return 2;
  }
  const storage = storageFromEnv();
  const entries: FalsePositiveRunEntry[] = [];

  if (listPath) {
    for (const line of readFileSync(listPath, "utf8").split("\n")) {
      const entry = line.trim();
      if (!entry || entry.startsWith("#")) continue;
      entries.push({
        label: entry,
        load: async () => (existsSync(entry) ? readFileSync(entry) : storage.download(entry)),
      });
    }
  }
  if (catalogRaw) {
    const limit = Number.parseInt(catalogRaw, 10);
    if (!Number.isInteger(limit) || limit <= 0) {
      console.error(`Invalid --catalog "${catalogRaw}": must be a positive integer.`);
      return 2;
    }
    const stems = await prisma.stem.findMany({
      where: {
        type: "original",
        isCurrent: true,
        isEncrypted: false,
        track: { release: { type: { not: "remix" } } },
      },
      select: { trackId: true, uri: true },
      orderBy: { id: "asc" },
      distinct: ["trackId"],
      take: limit,
    });
    for (const stem of stems) {
      entries.push({ label: `track:${stem.trackId}`, load: () => storage.download(stem.uri) });
    }
  }

  const report = await runRemixWatermarkFalsePositiveCheck({
    entries,
    detector,
    depth,
    lookup: (payloads) =>
      prisma.remixRenderWatermark.findMany({
        where: { token: { in: payloads } },
        select: { token: true, keyId: true },
      }),
    onProgress: (done, total, label) => {
      if (done % 25 === 0 || done === total) console.error(`${done}/${total} ${label}`);
    },
  });
  const storedTokens = await prisma.remixRenderWatermark.count();
  if (storedTokens === 0) {
    console.error(
      "No stored token to compare with: this run cannot find a false positive. Run it where renders have been marked.",
    );
  }
  console.log(JSON.stringify({ ...report, storedTokens, keyIds: detector.keyIds }, null, 2));
  return report.hits.length > 0 ? 1 : 0;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  })
  .finally(() => prisma.$disconnect());
