import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  runRetentionCleanup() {
    return {
      status: "ok",
      purged: {
        sessions: 0,
        uploads: 0,
        analytics: 0,
      },
      ranAt: new Date().toISOString(),
    };
  }

  async wipeReleases() {
    // Safety gate: only works when explicitly enabled via env var
    if (process.env.ENABLE_DEV_WIPE !== "true") {
      this.logger.warn("🚫 WIPE rejected: ENABLE_DEV_WIPE is not set to 'true'");
      return {
        status: "blocked",
        message: "Wipe is disabled. Set ENABLE_DEV_WIPE=true on this environment to enable.",
      };
    }

    this.logger.warn("⚠️  WIPE: Deleting all releases, tracks, stems, and related data...");

    // Delete in reverse FK order: deepest leaf tables first
    const deleted: Record<string, number> = {};

    // StemPurchase → StemListing
    deleted.stemPurchases = (await prisma.stemPurchase.deleteMany()).count;
    // RoyaltyPayment → listingId (from contract events)
    deleted.royaltyPayments = (await prisma.royaltyPayment.deleteMany()).count;
    // StemListing → Stem
    deleted.stemListings = (await prisma.stemListing.deleteMany()).count;
    // StemNftMint → Stem
    deleted.stemNftMints = (await prisma.stemNftMint.deleteMany()).count;
    // StemPricing → Stem
    deleted.stemPricing = (await prisma.stemPricing.deleteMany()).count;
    // License → Track
    deleted.licenses = (await prisma.license.deleteMany()).count;
    // LibraryTrack (uses trackId as string[], no FK but clean anyway)
    deleted.libraryTracks = (await prisma.libraryTrack.deleteMany()).count;
    // Stem → Track
    deleted.stems = (await prisma.stem.deleteMany()).count;
    // Track → Release
    deleted.tracks = (await prisma.track.deleteMany()).count;
    // Release (root)
    deleted.releases = (await prisma.release.deleteMany()).count;

    const result = {
      status: "wiped",
      deleted,
      ranAt: new Date().toISOString(),
    };

    this.logger.warn(`✅ WIPE COMPLETE: ${JSON.stringify(result.deleted)}`);
    return result;
  }
}
