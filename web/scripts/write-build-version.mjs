#!/usr/bin/env node
/*
 * Writes src/lib/buildVersion.ts with a unique-per-build identifier so the app
 * can detect when a newer version has been deployed (the "update available"
 * prompt). Runs automatically before `next build` (npm `prebuild` hook).
 *
 * Prefers a CI/commit SHA; falls back to local git, then a build timestamp, so
 * every build is distinct even in container builds without git history.
 */
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

function resolveVersion() {
  const fromEnv =
    process.env.NEXT_PUBLIC_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.CI_COMMIT_SHA;
  if (fromEnv) return String(fromEnv).slice(0, 12);
  try {
    return execSync("git rev-parse --short HEAD", {
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
  } catch {
    return `b${Date.now()}`;
  }
}

const version = resolveVersion();
const target = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "lib", "buildVersion.ts");

writeFileSync(
  target,
  `// AUTO-GENERATED at build time by scripts/write-build-version.mjs.\n` +
    `// The committed default ("dev") is used for local dev and tests.\n` +
    `export const BUILD_VERSION: string = ${JSON.stringify(version)};\n`,
);

console.log(`[build-version] buildVersion.ts -> ${version}`);
