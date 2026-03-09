import { Injectable, Logger, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";

@Injectable()
export class DmcaService {
  private readonly logger = new Logger(DmcaService.name);

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
      `DMCA report filed against track ${input.trackId} by ${input.claimantName} (${input.claimantEmail})`,
    );

    return report;
  }

  /**
   * File a counter-notification against a DMCA report.
   */
  async fileCounter(reportId: string, counterNotice: string) {
    const report = await prisma.dmcaReport.findUnique({
      where: { id: reportId },
    });

    if (!report) {
      throw new NotFoundException(`DMCA report ${reportId} not found`);
    }

    const updated = await prisma.dmcaReport.update({
      where: { id: reportId },
      data: {
        status: "countered",
        counterNotice,
      },
    });

    this.logger.log(`Counter-notification filed for DMCA report ${reportId}`);
    return updated;
  }

  /**
   * Resolve a DMCA report (admin action).
   * If upheld, cascades: track → dmca_removed, all derived stems delisted.
   */
  async resolveReport(reportId: string, outcome: "upheld" | "rejected") {
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

      // Delist all derived stems by clearing their URIs
      // (keeping records for audit trail but making them inaccessible)
      if (report.track.stems.length > 0) {
        await prisma.stem.updateMany({
          where: { trackId: report.trackId },
          data: { uri: "" },
        });

        this.logger.warn(
          `DMCA upheld for track ${report.trackId}: ` +
          `track removed + ${report.track.stems.length} stems delisted`,
        );
      }
    } else {
      this.logger.log(`DMCA rejected for track ${report.trackId}`);
    }

    return { outcome, trackId: report.trackId };
  }

  /**
   * List DMCA reports with optional status filter.
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
