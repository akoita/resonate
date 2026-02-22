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
    this.logger.warn("⚠️  WIPE: Deleting all releases, tracks, stems, and related data...");

    // Delete in reverse FK order: leaf tables first
    const listings = (await prisma.stemListing.deleteMany()).count;
    const mints = (await prisma.stemNftMint.deleteMany()).count;
    const pricing = (await prisma.stemPricing.deleteMany()).count;
    const licenses = (await prisma.license.deleteMany()).count;
    const stems = (await prisma.stem.deleteMany()).count;
    const tracks = (await prisma.track.deleteMany()).count;
    const releases = (await prisma.release.deleteMany()).count;

    const result = {
      status: "wiped",
      deleted: { releases, tracks, stems, listings, mints, pricing, licenses },
      ranAt: new Date().toISOString(),
    };

    this.logger.warn(`✅ WIPE COMPLETE: ${JSON.stringify(result.deleted)}`);
    return result;
  }
}
