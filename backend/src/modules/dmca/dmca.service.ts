import { randomUUID } from "crypto";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { hasReleaseManagementAccess } from "../management/management-access";
import { UploadRightsRoutingService } from "../rights/upload-rights-routing.service";
import { NoticeService } from "../notifications/notice.service";
import { EventBus } from "../shared/event_bus";
import { reconcileAndAnnounceRemixSourceHolds } from "../catalog/remix-source-hold";
import { EmailConfig } from "../email/email_config";
import { renderReportReceiptEmail } from "../email/email_templates";
import { EMAIL_TRANSPORT, emailErrorCode, type EmailTransport } from "../email/email_transport";
import { writeStructuredLog } from "../shared/structured_logging";
import { DMCA_CATEGORIES, DMCA_CLAIMANT_CAPACITIES, type DmcaCategory, type DmcaClaimantCapacity } from "./dmca.dto";

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

/** Receipt emails one address may get per day, so the form cannot be used to flood a stranger's inbox (#2664). */
export const DMCA_RECEIPTS_PER_ADDRESS_PER_DAY = 3;
const RECEIPT_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface FileDmcaReportInput {
  trackId: string;
  claimantName: string;
  claimantEmail: string;
  originalWorkUrl: string;
  reason: string;
  claimantCapacity?: DmcaClaimantCapacity;
  contentLocation?: string;
  category?: DmcaCategory;
  goodFaith?: boolean;
  /** Honeypot: hidden from people on the web form. */
  website?: string;
}

/** What a creator sees about a notice filed against one of their tracks: never the reporter's identity. */
export interface CreatorDmcaReport {
  id: string;
  trackId: string;
  trackTitle: string;
  releaseId: string;
  releaseTitle: string;
  category: string;
  status: string;
  statementOfReasons: string | null;
  counterNotice: string | null;
  canCounter: boolean;
  createdAt: Date;
  resolvedAt: Date | null;
}

@Injectable()
export class DmcaService {
  private readonly logger = new Logger(DmcaService.name);

  constructor(
    private readonly uploadRightsRoutingService: UploadRightsRoutingService,
    @Optional()
    private readonly noticeService?: NoticeService,
    @Optional()
    private readonly eventBus?: EventBus,
    @Optional() @Inject(EMAIL_TRANSPORT) private readonly transport?: EmailTransport | null,
    @Optional() private readonly emailConfig?: EmailConfig,
  ) {}

  /**
   * File a takedown notice against a track (public: no account needed).
   *
   * A filled honeypot field means a bot: nothing is stored, and the answer
   * looks the same so the bot learns nothing. A stored notice tells the
   * uploader (#2664) and, when email is configured, sends the reporter a
   * receipt with the reference.
   */
  async fileReport(input: FileDmcaReportInput) {
    if (isNonEmptyString(input?.website)) {
      this.logger.warn("DMCA report dropped: honeypot field was filled");
      return { id: randomUUID(), trackId: String(input.trackId ?? ""), status: "pending", createdAt: new Date(), receiptSent: false };
    }
    for (const field of REPORT_FIELDS) {
      if (!isNonEmptyString(input?.[field])) {
        throw new BadRequestException(`${field} is required`);
      }
    }
    if (input.goodFaith !== true) {
      throw new BadRequestException("goodFaith must be confirmed");
    }
    if (input.category !== undefined && !(DMCA_CATEGORIES as readonly string[]).includes(input.category)) {
      throw new BadRequestException("category is not recognised");
    }
    if (
      input.claimantCapacity !== undefined &&
      !(DMCA_CLAIMANT_CAPACITIES as readonly string[]).includes(input.claimantCapacity)
    ) {
      throw new BadRequestException("claimantCapacity is not recognised");
    }

    const track = await prisma.track.findUnique({
      where: { id: input.trackId },
    });

    if (!track) {
      throw new NotFoundException(`Track ${input.trackId} not found`);
    }

    const claimantEmail = input.claimantEmail.trim();
    const report = await prisma.dmcaReport.create({
      data: {
        trackId: input.trackId,
        claimantName: input.claimantName.trim(),
        claimantEmail,
        claimantCapacity: input.claimantCapacity ?? null,
        originalWorkUrl: input.originalWorkUrl.trim(),
        contentLocation: isNonEmptyString(input.contentLocation) ? input.contentLocation.trim() : null,
        category: input.category ?? "copyright",
        goodFaithAt: new Date(),
        reason: input.reason,
      },
    });

    this.logger.warn(
      `DMCA report ${report.id} filed against track ${input.trackId}`,
    );

    await this.notifyCreator(report.id, "received");
    const receiptSent = await this.sendReceipt(report.id, claimantEmail, report.createdAt);

    // The filing route is public: return only this report's own reference.
    return {
      id: report.id,
      trackId: report.trackId,
      status: report.status,
      createdAt: report.createdAt,
      receiptSent,
    };
  }

  /**
   * Email the reporter a receipt. Never fails the filing, and skipped when
   * email is off or this address already had its share of receipts today.
   */
  private async sendReceipt(reportId: string, address: string, now: Date): Promise<boolean> {
    if (!this.transport || !this.emailConfig?.frontendUrl) return false;
    const recent = await prisma.dmcaReport.count({
      where: {
        claimantEmail: { equals: address, mode: "insensitive" },
        createdAt: { gt: new Date(now.getTime() - RECEIPT_WINDOW_MS) },
      },
    });
    if (recent > DMCA_RECEIPTS_PER_ADDRESS_PER_DAY) return false;
    try {
      await this.transport.send(renderReportReceiptEmail(address, reportId, this.emailConfig));
      return true;
    } catch (error) {
      writeStructuredLog({
        level: "warn",
        event: "dmca.receipt_send_failed",
        message: "Could not send a takedown notice receipt",
        errorCode: emailErrorCode(error),
      });
      return false;
    }
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
    statementOfReasons?: string,
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
        statementOfReasons: isNonEmptyString(statementOfReasons) ? statementOfReasons.trim() : null,
      },
    });

    if (outcome === "upheld") {
      // Cascade: mark track as DMCA removed
      await prisma.track.update({
        where: { id: report.trackId },
        data: { contentStatus: "dmca_removed" },
      });
      await this.uploadRightsRoutingService.syncTrackRightsFromContentStatus(report.trackId);
      // Published remixes built on a removed track leave discovery too (#2601).
      await reconcileAndAnnounceRemixSourceHolds(this.eventBus, { trackIds: [report.trackId] });

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
      await this.notifyCreator(reportId, "upheld");
    } else {
      this.logger.log(
        `DMCA report ${reportId} rejected by user ${resolver.userId} for track ${report.trackId}`,
      );
      await this.notifyCreator(reportId, "rejected");
    }

    return { outcome, trackId: report.trackId };
  }

  /**
   * #2146, #2664: one in-app `moderation` notice to the creator per report and
   * stage, keyed on the report. A notice failure never undoes or fails the
   * filing or the decision.
   */
  private async notifyCreator(reportId: string, stage: "received" | "upheld" | "rejected") {
    if (!this.noticeService) return;
    try {
      if (stage === "received") await this.noticeService.notifyDmcaReceived(reportId);
      else if (stage === "rejected") await this.noticeService.notifyDmcaRejected(reportId);
      else await this.noticeService.notifyDmcaTakedown(reportId);
    } catch (error) {
      this.logger.error(`DMCA ${stage} notice for report ${reportId} failed: ${(error as Error).message}`);
    }
  }

  /**
   * Notices filed against tracks on releases the caller owns (the release's
   * management owner, else the artist account), newest first (#2664). Shows
   * the category, status and the reviewer's reasons; never the reporter's
   * identity, contact or words.
   */
  async listForCreator(userId: string): Promise<CreatorDmcaReport[]> {
    const rows = await prisma.dmcaReport.findMany({
      where: {
        track: {
          release: {
            OR: [
              { managementOwnerUserId: userId },
              { managementOwnerUserId: null, artist: { userId } },
            ],
          },
        },
      },
      select: {
        id: true,
        trackId: true,
        category: true,
        status: true,
        statementOfReasons: true,
        counterNotice: true,
        createdAt: true,
        resolvedAt: true,
        track: { select: { title: true, releaseId: true, release: { select: { title: true } } } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    return rows.map((row) => ({
      id: row.id,
      trackId: row.trackId,
      trackTitle: row.track.title,
      releaseId: row.track.releaseId,
      releaseTitle: row.track.release.title,
      category: row.category,
      status: row.status,
      statementOfReasons: row.statementOfReasons,
      counterNotice: row.counterNotice,
      canCounter: !COUNTER_CLOSED_STATUSES.has(row.status),
      createdAt: row.createdAt,
      resolvedAt: row.resolvedAt,
    }));
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
