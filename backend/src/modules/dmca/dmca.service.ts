import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { hasReleaseManagementAccess } from "../management/management-access";
import { UploadRightsRoutingService } from "../rights/upload-rights-routing.service";

/** Authenticated caller, as set on `req.user` by the JWT strategy. */
export interface DmcaActor {
  userId: string;
  role?: string;
}

const REVIEWER_ROLES = new Set(["admin", "operator"]);

/** Report states that no longer accept a counter-notice. */
const COUNTER_CLOSED_STATUSES = new Set(["countered", "rejected"]);

const REPORT_FIELDS = [
  "trackId",
  "claimantName",
  "claimantEmail",
  "originalWorkUrl",
  "reason",
] as const;

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

@Injectable()
export class DmcaService {
  private readonly logger = new Logger(DmcaService.name);

  constructor(
    private readonly uploadRightsRoutingService: UploadRightsRoutingService,
  ) {}

  /**
   * File a DMCA takedown report against a track.
   */
  async fileReport(input: {
    trackId: string;
    claimantName: string;
    claimantEmail: string;
    originalWorkUrl: string;
    reason: string;
  }) {
    for (const field of REPORT_FIELDS) {
      if (!isNonEmptyString(input?.[field])) {
        throw new BadRequestException(`${field} is required`);
      }
    }

    const track = await prisma.track.findUnique({
      where: { id: input.trackId },
    });

    if (!track) {
      throw new NotFoundException(`Track ${input.trackId} not found`);
    }

    const report = await prisma.dmcaReport.create({
      data: {
        trackId: input.trackId,
        claimantName: input.claimantName,
        claimantEmail: input.claimantEmail,
        originalWorkUrl: input.originalWorkUrl,
        reason: input.reason,
      },
    });

    this.logger.warn(
      `DMCA report ${report.id} filed against track ${input.trackId}`,
    );

    // The filing route is public: return only this report's own reference.
    return {
      id: report.id,
      trackId: report.trackId,
      status: report.status,
      createdAt: report.createdAt,
    };
  }

  /**
   * File a counter-notification against a DMCA report.
   *
   * The caller must own or manage the release the reported track belongs to
   * (release management owner, else the artist account, else an active
   * catalog-metadata grant on that release), or hold an admin/operator role.
   */
  async fileCounter(reportId: string, counterNotice: string, actor: DmcaActor) {
    if (!isNonEmptyString(reportId)) {
      throw new BadRequestException("reportId is required");
    }
    if (!isNonEmptyString(counterNotice)) {
      throw new BadRequestException("counterNotice is required");
    }

    const report = await prisma.dmcaReport.findUnique({
      where: { id: reportId },
      include: { track: { select: { releaseId: true } } },
    });

    if (!report) {
      throw new NotFoundException(`DMCA report ${reportId} not found`);
    }

    const isReviewer = !!actor.role && REVIEWER_ROLES.has(actor.role);
    if (
      !isReviewer &&
      !(await hasReleaseManagementAccess(
        actor.userId,
        report.track.releaseId,
        "catalog_metadata",
      ))
    ) {
      throw new ForbiddenException("You do not have access to this release");
    }

    if (COUNTER_CLOSED_STATUSES.has(report.status)) {
      throw new BadRequestException(
        `DMCA report ${reportId} is ${report.status} and does not accept a counter-notice`,
      );
    }

    const updated = await prisma.dmcaReport.update({
      where: { id: reportId },
      data: {
        status: "countered",
        counterNotice,
      },
    });

    this.logger.log(
      `Counter-notification filed for DMCA report ${reportId} by user ${actor.userId}`,
    );

    // Claimant contact details stay with reviewers; return only report state.
    return {
      id: updated.id,
      trackId: updated.trackId,
      status: updated.status,
      counterNotice: updated.counterNotice,
      createdAt: updated.createdAt,
    };
  }

  /**
   * Resolve a DMCA report (admin/operator action).
   * If upheld, cascades: track → dmca_removed, all derived stems delisted.
   * The resolver is the authenticated caller, recorded in the audit log.
   */
  async resolveReport(
    reportId: string,
    outcome: "upheld" | "rejected",
    resolver: DmcaActor,
  ) {
    if (outcome !== "upheld" && outcome !== "rejected") {
      throw new BadRequestException('outcome must be "upheld" or "rejected"');
    }

    const report = await prisma.dmcaReport.findUnique({
      where: { id: reportId },
      include: { track: { include: { stems: true } } },
    });

    if (!report) {
      throw new NotFoundException(`DMCA report ${reportId} not found`);
    }

    // Update report status
    await prisma.dmcaReport.update({
      where: { id: reportId },
      data: {
        status: outcome,
        resolvedAt: new Date(),
      },
    });

    if (outcome === "upheld") {
      // Cascade: mark track as DMCA removed
      await prisma.track.update({
        where: { id: report.trackId },
        data: { contentStatus: "dmca_removed" },
      });
      await this.uploadRightsRoutingService.syncTrackRightsFromContentStatus(report.trackId);

      // Delist all derived stems by clearing their URIs
      // (keeping records for audit trail but making them inaccessible)
      if (report.track.stems.length > 0) {
        await prisma.stem.updateMany({
          where: { trackId: report.trackId },
          data: { uri: "" },
        });
      }

      this.logger.warn(
        `DMCA report ${reportId} upheld by user ${resolver.userId}: ` +
          `track ${report.trackId} removed + ${report.track.stems.length} stems delisted`,
      );
    } else {
      this.logger.log(
        `DMCA report ${reportId} rejected by user ${resolver.userId} for track ${report.trackId}`,
      );
    }

    return { outcome, trackId: report.trackId };
  }

  /**
   * List DMCA reports with optional status filter (admin/operator only:
   * includes claimant contact details).
   */
  async listReports(status?: string) {
    return prisma.dmcaReport.findMany({
      where: status ? { status } : undefined,
      include: {
        track: {
          select: { id: true, title: true, releaseId: true },
        },
      },
      orderBy: { createdAt: "desc" },
    });
  }
}
