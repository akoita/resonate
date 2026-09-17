import { Injectable, Logger } from "@nestjs/common";
import { PrismaClient } from "@prisma/client";
import { AnalyticsGovernanceService } from "../analytics/analytics_governance.service";
import { AnalyticsPipelineObservabilityService } from "../analytics/analytics_observability.service";
import { AnalyticsWarehouseLoadRequest, AnalyticsWarehouseLoaderService } from "../analytics/analytics_warehouse_loader";
import {
  CommunityCohortGenerationRequest,
  CommunityCohortGenerationService,
} from "../community/community_cohort_generation.service";
import { CommunityCohortQualityService } from "../community/community_cohort_quality.service";
import { CommunityRoomsService } from "../community/community_rooms.service";
import { PersonalDataErasureService } from "../privacy/personal_data_erasure.service";

const prisma = new PrismaClient();

@Injectable()
export class MaintenanceService {
  private readonly logger = new Logger(MaintenanceService.name);

  constructor(
    private readonly analyticsGovernanceService: AnalyticsGovernanceService,
    private readonly analyticsWarehouseLoaderService: AnalyticsWarehouseLoaderService,
    private readonly analyticsPipelineObservabilityService: AnalyticsPipelineObservabilityService,
    private readonly communityCohortGenerationService: CommunityCohortGenerationService,
    private readonly communityCohortQualityService: CommunityCohortQualityService,
    private readonly communityRoomsService: CommunityRoomsService,
    private readonly personalDataErasureService: PersonalDataErasureService,
  ) {}

  async runRetentionCleanup() {
    const analytics = await this.analyticsGovernanceService.runRetentionCleanup();
    return {
      status: "ok",
      purged: {
        sessions: 0,
        uploads: 0,
        analytics: analytics.deleted,
      },
      redacted: {
        analytics: analytics.redacted,
      },
      lineageRecords: {
        analytics: analytics.lineageRecords,
      },
      ranAt: new Date().toISOString(),
    };
  }

  /**
   * Erase the accounts whose 30-day closure window has elapsed (#1771 slice 3).
   *
   * The external scheduler's entry point. Each request is settled on its own
   * row — completed, or failed with the reason written to the database — so a
   * failure is durable and readable rather than logged and lost, and one
   * person's failure does not strand the queue behind it.
   */
  async runDueAccountErasures(input: { limit?: unknown } = {}) {
    const limit = typeof input.limit === "string" ? Number.parseInt(input.limit, 10) : input.limit;
    return this.personalDataErasureService.runDueErasures({
      limit: typeof limit === "number" && Number.isSafeInteger(limit) && limit > 0 ? limit : undefined,
    });
  }

  async loadAnalyticsWarehouse(request: AnalyticsWarehouseLoadRequest) {
    return this.analyticsWarehouseLoaderService.load(request);
  }

  async backfillAnalyticsWarehouse(request: AnalyticsWarehouseLoadRequest) {
    return this.analyticsWarehouseLoaderService.backfill(request);
  }

  async getAnalyticsPipelineHealth() {
    return this.analyticsPipelineObservabilityService.getPipelineHealth();
  }

  async generateCommunityCohorts(request: CommunityCohortGenerationRequest) {
    return this.communityCohortGenerationService.generateCohorts(request);
  }

  async getCommunityCohortQuality() {
    return this.communityCohortQualityService.getQualityReport();
  }

  async getCommunityModerationQueue(input: { status?: unknown; limit?: unknown } = {}) {
    return this.communityRoomsService.getModerationQueue(input);
  }

  async resolveCommunityModerationReport(
    actor: { userId: string; role?: string | null },
    reportId: string,
    input: { action?: unknown; note?: unknown } = {},
  ) {
    return this.communityRoomsService.resolveModerationReport(actor, reportId, input);
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
