#!/usr/bin/env npx ts-node
/**
 * Dev utility: Wipe all releases, tracks, stems, and related data.
 *
 * Usage:
 *   cd backend && npx ts-node scripts/wipe-releases.ts          # local
 *   cd backend && npx ts-node scripts/wipe-releases.ts --force  # skip confirmation
 *   make wipe-releases                                           # via Makefile
 *
 * Reads DATABASE_URL from .env / environment.
 * Also cleans up GCS stems bucket if GCS_STEMS_BUCKET is set.
 */

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const force = process.argv.includes("--force");

async function confirm(message: string): Promise<boolean> {
  if (force) return true;
  const readline = await import("readline");
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer: string) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

async function main() {
  // Count current data
  const releaseCount = await prisma.release.count();
  const trackCount = await prisma.track.count();
  const stemCount = await prisma.stem.count();
  const listingCount = await prisma.stemListing.count();
  const mintCount = await prisma.stemNftMint.count();
  const pricingCount = await prisma.stemPricing.count();
  const licenseCount = await prisma.license.count();

  console.log("\n📊 Current database state:");
  console.log(`   Releases:     ${releaseCount}`);
  console.log(`   Tracks:       ${trackCount}`);
  console.log(`   Stems:        ${stemCount}`);
  console.log(`   Listings:     ${listingCount}`);
  console.log(`   NFT Mints:    ${mintCount}`);
  console.log(`   Pricing:      ${pricingCount}`);
  console.log(`   Licenses:     ${licenseCount}`);

  if (releaseCount === 0 && trackCount === 0 && stemCount === 0) {
    console.log("\n✅ Database is already clean. Nothing to wipe.");
    return;
  }

  const ok = await confirm(`\n⚠️  This will permanently delete ALL of the above. Continue?`);
  if (!ok) {
    console.log("Aborted.");
    return;
  }

  console.log("\n🗑️  Wiping data (respecting FK order)...");

  // Delete in reverse FK order: leaf tables first
  const deleted = {
    listings: (await prisma.stemListing.deleteMany()).count,
    mints: (await prisma.stemNftMint.deleteMany()).count,
    pricing: (await prisma.stemPricing.deleteMany()).count,
    licenses: (await prisma.license.deleteMany()).count,
    stems: (await prisma.stem.deleteMany()).count,
    tracks: (await prisma.track.deleteMany()).count,
    releases: (await prisma.release.deleteMany()).count,
  };

  console.log("\n✅ Deleted:");
  for (const [table, count] of Object.entries(deleted)) {
    if (count > 0) console.log(`   ${table}: ${count}`);
  }

  // Clean up GCS bucket
  const bucket = process.env.GCS_STEMS_BUCKET;
  if (bucket) {
    console.log(`\n🪣 Cleaning GCS bucket: gs://${bucket}/stems/...`);
    try {
      const { execSync } = await import("child_process");
      execSync(`gsutil -m rm -r "gs://${bucket}/stems/" 2>/dev/null || true`, { stdio: "inherit" });
      console.log("   GCS stems cleaned.");
    } catch {
      console.warn("   ⚠️ Could not clean GCS (gsutil not available or bucket empty).");
    }
  }

  // Clean up local uploads
  try {
    const { existsSync, rmSync } = await import("fs");
    const { join } = await import("path");
    const uploadsDir = join(process.cwd(), "uploads", "stems");
    if (existsSync(uploadsDir)) {
      rmSync(uploadsDir, { recursive: true, force: true });
      console.log("\n🧹 Cleaned local uploads/stems directory.");
    }
  } catch {
    // Not critical
  }

  console.log("\n🎉 Wipe complete!\n");
}

main()
  .catch((err) => {
    console.error("❌ Wipe failed:", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
