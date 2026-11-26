import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { StorageProvider } from "../storage/storage_provider";
import { NoticeService } from "../notifications/notice.service";
import {
  currentDraftVersionKey,
  draftMimeTypeFromUri,
  draftOutputUriFromMetadata,
  previousDraftsFromMetadata,
} from "./remix-project.service";

/**
 * Artist approval of one AI-assisted remix version (#2682).
 *
 * An artist who chose "Ask me before AI-assisted remixes of my music are
 * shared" (`Artist.aiRemixApproval = required`) keeps every other creator's
 * remix of their work to a private draft (eligibility policy v7). This
 * service is the approval step: the creator asks for the current draft
 * version, the artist previews it and approves or declines, and eligibility
 * (policy v8) grants publish and export for an approved version only. A new
 * draft is a new version and needs a new approval.
 */

export const REMIX_APPROVAL_STATUSES = ["pending", "approved", "declined"] as const;
export type RemixApprovalStatus = (typeof REMIX_APPROVAL_STATUSES)[number];
export const REMIX_APPROVAL_TEXT_MAX = 500;
/** Where the artist answers; the notice links here. */
export const REMIX_APPROVALS_PATH = "/artist/remix-approvals";

export type RemixApprovalDecision = "approve" | "decline";

type SourceArtist = {
  id: string;
  displayName: string;
  userId: string | null;
  managementOwnerUserId: string | null;
  aiRemixApproval: string;
};

export type RemixApprovalView = {
  id: string;
  remixProjectId: string;
  versionKey: string;
  status: RemixApprovalStatus;
  message: string | null;
  reason: string | null;
  createdAt: string;
  decidedAt: string | null;
  sourceArtist: { id: string; displayName: string };
};

export type RemixProjectApprovalState = {
  /** Source artists whose approval this remix needs (empty: none needed). */
  requiredArtists: Array<{ id: string; displayName: string }>;
  /** Version key of the current completed draft, or null when there is none. */
  currentVersionKey: string | null;
  /** Requests for the current version, one per artist at most. */
  current: RemixApprovalView[];
  /** True when every required artist approved the current version. */
  approved: boolean;
};

export type IncomingRemixApproval = RemixApprovalView & {
  remixTitle: string;
  sourceTrack: { id: string; title: string };
  /** The creator's public name (their artist profile), never an email. */
  creatorName: string;
  /** False when the creator replaced or deleted this version since asking. */
  versionAvailable: boolean;
};

function cleanText(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new BadRequestException(`${field} must be text`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > REMIX_APPROVAL_TEXT_MAX) {
    throw new BadRequestException(
      `${field} must be at most ${REMIX_APPROVAL_TEXT_MAX} characters`,
    );
  }
  return trimmed;
}

function toView(row: {
  id: string;
  remixProjectId: string;
  versionKey: string;
  status: string;
  message: string | null;
  reason: string | null;
  createdAt: Date;
  decidedAt: Date | null;
  sourceArtist: { id: string; displayName: string };
}): RemixApprovalView {
  return {
    id: row.id,
    remixProjectId: row.remixProjectId,
    versionKey: row.versionKey,
    status: (REMIX_APPROVAL_STATUSES as readonly string[]).includes(row.status)
      ? (row.status as RemixApprovalStatus)
      : "pending",
    message: row.message,
    reason: row.reason,
    createdAt: row.createdAt.toISOString(),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    sourceArtist: { id: row.sourceArtist.id, displayName: row.sourceArtist.displayName },
  };
}

/** The account that answers for an artist: the artist's own, else its manager. */
function answeringUserId(artist: SourceArtist): string | null {
  return artist.userId ?? artist.managementOwnerUserId ?? null;
}

function canAnswerFor(userId: string, artist: SourceArtist): boolean {
  return artist.userId === userId || (!artist.userId && artist.managementOwnerUserId === userId);
}

const ARTIST_SELECT = {
  id: true,
  displayName: true,
  userId: true,
  managementOwnerUserId: true,
  aiRemixApproval: true,
} as const;

const REQUEST_INCLUDE = {
  sourceArtist: { select: ARTIST_SELECT },
} as const;

@Injectable()
export class RemixApprovalService {
  private readonly logger = new Logger(RemixApprovalService.name);

  constructor(
    private readonly storageProvider: StorageProvider,
    @Optional() private readonly notices?: NoticeService,
  ) {}

  /**
   * The artists (one per source track) whose approval a project needs: their
   * setting is "required" and the creator is not the artist.
   */
  private async requiredArtists(project: {
    creatorUserId: string;
    sourceTrackId: string;
    secondarySourceTrackId: string | null;
  }): Promise<SourceArtist[]> {
    const trackIds = [project.sourceTrackId, project.secondarySourceTrackId].filter(
      (id): id is string => !!id,
    );
    const tracks = await prisma.track.findMany({
      where: { id: { in: trackIds } },
      select: { release: { select: { artist: { select: ARTIST_SELECT } } } },
    });
    const byId = new Map<string, SourceArtist>();
    for (const track of tracks) {
      const artist = track.release?.artist;
      if (!artist || artist.aiRemixApproval !== "required") continue;
      if (canAnswerFor(project.creatorUserId, artist)) continue;
      byId.set(artist.id, artist);
    }
    return Array.from(byId.values());
  }

  private async loadOwnedProject(userId: string, projectId: string) {
    const project = await prisma.remixProject.findUnique({
      where: { id: projectId },
      select: {
        id: true,
        title: true,
        status: true,
        creatorUserId: true,
        sourceTrackId: true,
        secondarySourceTrackId: true,
        generationJobId: true,
        generationMetadata: true,
      },
    });
    if (!project) throw new NotFoundException(`Remix project ${projectId} not found`);
    if (project.creatorUserId !== userId) {
      throw new ForbiddenException("You do not have access to this remix project");
    }
    return project;
  }

  /** The creator's view: who must approve and where the current version stands. */
  async projectState(userId: string, projectId: string): Promise<RemixProjectApprovalState> {
    const project = await this.loadOwnedProject(userId, projectId);
    const artists = await this.requiredArtists(project);
    const versionKey = currentDraftVersionKey(project);
    const rows =
      versionKey && artists.length > 0
        ? await prisma.remixApprovalRequest.findMany({
            where: { remixProjectId: project.id, versionKey },
            include: REQUEST_INCLUDE,
            orderBy: { createdAt: "asc" },
          })
        : [];
    const current = rows.map(toView);
    const approvedIds = new Set(
      current.filter((row) => row.status === "approved").map((row) => row.sourceArtist.id),
    );
    return {
      requiredArtists: artists.map((artist) => ({ id: artist.id, displayName: artist.displayName })),
      currentVersionKey: versionKey,
      current,
      approved: artists.length > 0 && artists.every((artist) => approvedIds.has(artist.id)),
    };
  }

  /**
   * Ask every required artist to approve the current draft version. Idempotent
   * per artist and version: a pending or approved request is kept as it is.
   * A declined version cannot be asked again; the creator makes a new draft.
   */
  async requestApproval(
    userId: string,
    projectId: string,
    input: { message?: unknown } = {},
  ): Promise<RemixProjectApprovalState> {
    const message = cleanText(input.message, "message");
    const project = await this.loadOwnedProject(userId, projectId);
    if (project.status !== "draft") {
      throw new ConflictException({
        code: "project_not_draft",
        message: "Only a draft remix can be sent for approval.",
      });
    }
    const versionKey = currentDraftVersionKey(project);
    if (!versionKey) {
      throw new ConflictException({
        code: "draft_not_completed",
        message: "Render a draft and wait for it to finish before asking the artist.",
      });
    }
    const artists = await this.requiredArtists(project);
    if (artists.length === 0) {
      throw new ConflictException({
        code: "approval_not_needed",
        message: "The artists of this remix's sources do not ask to approve remixes.",
      });
    }

    const existing = await prisma.remixApprovalRequest.findMany({
      where: { remixProjectId: project.id, versionKey },
      select: { sourceArtistId: true, status: true },
    });
    const existingByArtist = new Map(existing.map((row) => [row.sourceArtistId, row.status]));
    if (artists.some((artist) => existingByArtist.get(artist.id) === "declined")) {
      throw new ConflictException({
        code: "version_declined",
        message: "The artist declined this version. Make a new draft to ask again.",
      });
    }

    for (const artist of artists) {
      if (existingByArtist.has(artist.id)) continue;
      const created = await prisma.remixApprovalRequest
        .create({
          data: {
            remixProjectId: project.id,
            sourceArtistId: artist.id,
            requesterUserId: userId,
            versionKey,
            message,
          },
          select: { id: true },
        })
        .catch((error: { code?: string }) => {
          // A concurrent request for the same version won the unique index.
          if (error?.code === "P2002") return null;
          throw error;
        });
      if (created) await this.notifyArtist(artist, created.id);
    }
    return this.projectState(userId, projectId);
  }

  /** Requests waiting on (or answered by) the artists this account answers for. */
  async listIncoming(
    userId: string,
    status?: string,
  ): Promise<IncomingRemixApproval[]> {
    if (status && !(REMIX_APPROVAL_STATUSES as readonly string[]).includes(status)) {
      throw new BadRequestException("status must be pending, approved or declined");
    }
    const rows = await prisma.remixApprovalRequest.findMany({
      where: {
        ...(status ? { status } : {}),
        sourceArtist: {
          OR: [{ userId }, { userId: null, managementOwnerUserId: userId }],
        },
      },
      include: {
        ...REQUEST_INCLUDE,
        remixProject: {
          select: {
            title: true,
            generationJobId: true,
            generationMetadata: true,
            sourceTrack: { select: { id: true, title: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    });
    const creatorIds = Array.from(new Set(rows.map((row) => row.requesterUserId)));
    const creatorArtists = creatorIds.length
      ? await prisma.artist.findMany({
          where: { userId: { in: creatorIds } },
          select: { userId: true, displayName: true },
        })
      : [];
    const nameByUser = new Map(creatorArtists.map((artist) => [artist.userId, artist.displayName]));
    return rows.map((row) => ({
      ...toView(row),
      remixTitle: row.remixProject.title,
      sourceTrack: row.remixProject.sourceTrack,
      creatorName: nameByUser.get(row.requesterUserId)?.trim() || "A remix creator",
      versionAvailable: this.versionOutputUri(row.remixProject, row.versionKey) !== null,
    }));
  }

  private versionOutputUri(
    project: { generationJobId: string | null; generationMetadata: unknown },
    versionKey: string,
  ): string | null {
    if (currentDraftVersionKey(project) === versionKey) {
      return draftOutputUriFromMetadata(project.generationMetadata);
    }
    const archived = previousDraftsFromMetadata(project.generationMetadata).find(
      (entry) => entry.jobId === versionKey,
    );
    return archived?.output.outputUri ?? null;
  }

  private async loadForArtist(userId: string, requestId: string) {
    const row = await prisma.remixApprovalRequest.findUnique({
      where: { id: requestId },
      include: {
        ...REQUEST_INCLUDE,
        remixProject: {
          select: {
            id: true,
            title: true,
            creatorUserId: true,
            generationJobId: true,
            generationMetadata: true,
          },
        },
      },
    });
    // Not found and not yours look the same, so ids cannot be probed.
    if (!row || !canAnswerFor(userId, row.sourceArtist)) {
      throw new NotFoundException("Approval request not found");
    }
    return row;
  }

  /** The exact version the artist is asked about, for preview. */
  async previewAudio(userId: string, requestId: string) {
    const row = await this.loadForArtist(userId, requestId);
    const outputUri = this.versionOutputUri(row.remixProject, row.versionKey);
    if (!outputUri) {
      throw new NotFoundException({
        code: "version_unavailable",
        message: "The creator replaced or deleted this version.",
      });
    }
    const data = await this.storageProvider.download(outputUri);
    if (!data) throw new NotFoundException("Remix audio not found");
    return { data, mimeType: draftMimeTypeFromUri(outputUri) };
  }

  /** Approve or decline a pending request. Each request is answered once. */
  async decide(
    userId: string,
    requestId: string,
    input: { decision?: unknown; reason?: unknown },
  ): Promise<RemixApprovalView> {
    if (input.decision !== "approve" && input.decision !== "decline") {
      throw new BadRequestException("decision must be approve or decline");
    }
    const decision = input.decision as RemixApprovalDecision;
    const reason = cleanText(input.reason, "reason");
    const row = await this.loadForArtist(userId, requestId);
    if (decision === "approve" && !this.versionOutputUri(row.remixProject, row.versionKey)) {
      throw new ConflictException({
        code: "version_unavailable",
        message: "The creator replaced or deleted this version, so there is nothing to approve.",
      });
    }
    const status: RemixApprovalStatus = decision === "approve" ? "approved" : "declined";
    const decidedAt = new Date();
    const updated = await prisma.remixApprovalRequest.updateMany({
      where: { id: row.id, status: "pending" },
      data: { status, reason, decidedAt, decidedByUserId: userId },
    });
    if (updated.count === 0) {
      throw new ConflictException({
        code: "already_decided",
        message: "This request was already answered.",
      });
    }
    await this.notifyCreator(
      row.remixProject,
      row.sourceArtist.displayName,
      status,
      reason,
      row.id,
    );
    return toView({ ...row, status, reason, decidedAt });
  }

  private async notifyArtist(artist: SourceArtist, requestId: string) {
    const recipient = answeringUserId(artist);
    if (!this.notices || !recipient) return;
    try {
      await this.notices.sendTargeted(
        {
          userIds: [recipient],
          category: "service",
          title: "A remix of your music is waiting for your approval",
          body:
            "You asked to approve AI-assisted remixes of your music before they are shared. "
            + "Listen to it, then approve or decline. Nothing is shared until you approve.",
          link: REMIX_APPROVALS_PATH,
        },
        { userId: "system:remix" },
        { dedupeKey: `remix_approval_request:${requestId}` },
      );
    } catch (error) {
      // The request stands; the artist also sees it on the approvals page.
      this.logger.warn(`Approval request notice failed: ${(error as Error).message}`);
    }
  }

  private async notifyCreator(
    project: { id: string; title: string; creatorUserId: string },
    artistName: string,
    status: RemixApprovalStatus,
    reason: string | null,
    requestId: string,
  ) {
    if (!this.notices) return;
    const approved = status === "approved";
    try {
      await this.notices.sendTargeted(
        {
          userIds: [project.creatorUserId],
          category: "service",
          title: (approved
            ? `${artistName} approved your remix`
            : `${artistName} declined your remix`
          ).slice(0, 120),
          body: approved
            ? `"${project.title}" can now be published and, with the right licence, exported. A new draft needs a new approval.`.slice(0, 2000)
            : `"${project.title}" stays a private draft.${reason ? ` The artist said: ${reason}` : ""}`.slice(0, 2000),
          link: `/remix/studio/${project.id}`,
        },
        { userId: "system:remix" },
        { dedupeKey: `remix_approval_decision:${requestId}` },
      );
    } catch (error) {
      this.logger.warn(`Approval decision notice failed: ${(error as Error).message}`);
    }
  }
}
