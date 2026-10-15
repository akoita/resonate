import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { Subscription } from "rxjs";
import { prisma } from "../../db/prisma";
import { CommunityModerationActionTakenEvent } from "../../events/event_types";
import { AuditService } from "../audit/audit.service";
import { EventBus } from "../shared/event_bus";
import {
  BroadcastNoticeInput,
  NoticeCategory,
  TargetedNoticeInput,
  parseBroadcastNoticeInput,
  parseTargetedNoticeInput,
} from "./notice_validation";

/** Who sent a notice: an operator's user id, or a `system:<source>` actor. */
export interface NoticeActor {
  userId: string;
  role?: string;
}

export interface NoticeDto {
  id: string;
  kind: "broadcast" | "targeted";
  category: NoticeCategory;
  title: string;
  body: string;
  link: string | null;
  effectiveAt: string | null;
  createdAt: string;
  readAt: string | null;
}

/** How many notices a person's list returns (newest first). */
const LIST_LIMIT = 50;
/** Help article every moderation notice links to. */
export const NOTICES_HELP_PATH = "/help/platform-notices";
const MODERATION_ACTOR: NoticeActor = { userId: "system:community-moderation" };

type NoticeRow = Prisma.NoticeGetPayload<{ include: { reads: { select: { readAt: true } } } }>;

/**
 * Platform notices (#2146): messages the platform itself originates, as
 * opposed to `NotificationService`, which fans out product events.
 *
 * - `sendTargeted` writes one row per listed recipient; only that recipient
 *   ever lists or reads it. Other features (#2147 suspension, #2149 refund
 *   reminders) call it directly with a `system:<source>` actor.
 * - `sendBroadcast` writes ONE row resolved at read time, so it reaches every
 *   matching person including those who sign up after it was sent.
 * - A community moderation action that hits a person's message sends them one
 *   `moderation` notice, keyed on the report id so a replayed event is a no-op.
 *
 * Every send is audited with counts, never with targeted bodies.
 */
@Injectable()
export class NoticeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NoticeService.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly audit: AuditService,
  ) {}

  onModuleInit() {
    this.subscriptions.push(
      this.eventBus.subscribe(
        "community.moderation_action_taken",
        async (event: CommunityModerationActionTakenEvent) => {
          await this.notifyCommunityModerationAction({ reportId: event.reportId, action: event.action });
        },
      ),
    );
  }

  onModuleDestroy() {
    this.subscriptions.forEach((s) => s.unsubscribe());
    this.subscriptions.length = 0;
  }

  // ============ Sending ============

  /**
   * One notice per listed recipient. Unknown user ids reject the whole call so
   * a caller never believes a person was told when they were not. With a
   * `dedupeKey`, a repeat call for the same recipient creates nothing.
   */
  async sendTargeted(
    input: TargetedNoticeInput,
    actor: NoticeActor,
    options: { dedupeKey?: string } = {},
  ): Promise<{ recipientCount: number; created: number }> {
    const parsed = parseTargetedNoticeInput(input);
    const existing = await prisma.user.findMany({
      where: { id: { in: parsed.userIds } },
      select: { id: true },
    });
    const missing = parsed.userIds.length - existing.length;
    if (missing > 0) {
      throw new BadRequestException(`${missing} recipient(s) do not exist`);
    }

    const result = await prisma.notice.createMany({
      data: parsed.userIds.map((userId) => ({
        category: parsed.category,
        title: parsed.title,
        body: parsed.body,
        link: parsed.link ?? null,
        audience: "user",
        recipientUserId: userId,
        dedupeKey: options.dedupeKey ?? null,
        createdBy: actor.userId,
      })),
      skipDuplicates: Boolean(options.dedupeKey),
    });

    // Counts only: a targeted notice may concern one person's account.
    this.audit.log({
      action: "notice.sent",
      actorId: actor.userId,
      resource: "notice",
      metadata: {
        kind: "targeted",
        category: parsed.category,
        recipientCount: parsed.userIds.length,
        created: result.count,
        ...(options.dedupeKey ? { deduplicated: parsed.userIds.length - result.count } : {}),
      },
    });
    return { recipientCount: parsed.userIds.length, created: result.count };
  }

  /** One row for the whole audience, resolved when each person lists notices. */
  async sendBroadcast(input: BroadcastNoticeInput, actor: NoticeActor) {
    const parsed = parseBroadcastNoticeInput(input);
    const notice = await prisma.notice.create({
      data: {
        category: parsed.category,
        title: parsed.title,
        body: parsed.body,
        link: parsed.link ?? null,
        audience: parsed.audience,
        effectiveAt: parsed.effectiveAt ?? null,
        expiresAt: parsed.expiresAt ?? null,
        createdBy: actor.userId,
      },
    });
    this.audit.log({
      action: "notice.sent",
      actorId: actor.userId,
      resource: `notice:${notice.id}`,
      metadata: {
        kind: "broadcast",
        category: notice.category,
        audience: notice.audience,
        title: notice.title,
      },
    });
    return {
      id: notice.id,
      category: notice.category,
      title: notice.title,
      body: notice.body,
      link: notice.link,
      audience: notice.audience,
      effectiveAt: notice.effectiveAt?.toISOString() ?? null,
      expiresAt: notice.expiresAt?.toISOString() ?? null,
      createdBy: notice.createdBy,
      createdAt: notice.createdAt.toISOString(),
    };
  }

  // ============ Reading ============

  /** Targeted notices for this person plus active broadcasts for their audience. */
  async listForUser(userId: string, role: string | undefined) {
    const where = await this.visibleTo(userId, role);
    const [rows, unreadCount] = await Promise.all([
      prisma.notice.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: LIST_LIMIT,
        include: { reads: { where: { userId }, select: { readAt: true } } },
      }),
      prisma.notice.count({ where: { AND: [where, { reads: { none: { userId } } }] } }),
    ]);
    return { notices: rows.map(toNoticeDto), unreadCount };
  }

  /** Mark a notice read (or dismiss its banner). 404 unless the person can see it. */
  async markRead(userId: string, role: string | undefined, noticeId: string) {
    const where = await this.visibleTo(userId, role);
    const notice = await prisma.notice.findFirst({ where: { AND: [where, { id: noticeId }] }, select: { id: true } });
    if (!notice) throw new NotFoundException("Notice not found");
    const read = await prisma.noticeRead.upsert({
      where: { noticeId_userId: { noticeId, userId } },
      create: { noticeId, userId },
      update: {},
    });
    return { id: noticeId, readAt: read.readAt.toISOString() };
  }

  /** Broadcasts already sent, newest first, for the operator page. */
  async listSentBroadcasts() {
    const rows = await prisma.notice.findMany({
      where: { recipientUserId: null },
      orderBy: { createdAt: "desc" },
      take: LIST_LIMIT,
      include: { _count: { select: { reads: true } } },
    });
    const now = Date.now();
    return {
      notices: rows.map((row) => ({
        id: row.id,
        category: row.category,
        title: row.title,
        body: row.body,
        link: row.link,
        audience: row.audience,
        effectiveAt: row.effectiveAt?.toISOString() ?? null,
        expiresAt: row.expiresAt?.toISOString() ?? null,
        active: !row.expiresAt || row.expiresAt.getTime() > now,
        createdBy: row.createdBy,
        createdAt: row.createdAt.toISOString(),
        readCount: row._count.reads,
      })),
    };
  }

  /**
   * The audiences a person belongs to: everyone, their session role, and
   * `artist` when they own an artist profile (artist sessions carry the
   * `listener` role, so the profile is the reliable signal).
   */
  private async visibleTo(userId: string, role: string | undefined): Promise<Prisma.NoticeWhereInput> {
    const audiences = new Set<string>(["all", `role:${role || "listener"}`]);
    const artist = await prisma.artist.findFirst({ where: { userId }, select: { id: true } });
    if (artist) audiences.add("role:artist");
    return {
      OR: [
        { recipientUserId: userId },
        {
          recipientUserId: null,
          audience: { in: Array.from(audiences) },
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      ],
    };
  }

  // ============ Moderation hook ============

  /**
   * Tell the author of a reported community message what a moderator did
   * about it. States the action and the reason category (a report under the
   * community guidelines) — never the reporter's text or the operator's note.
   * Room-wide actions (pause/archive) and `no_action` do not single anyone out
   * and send nothing. Keyed on the report id: exactly one notice per action.
   */
  async notifyCommunityModerationAction(input: { reportId: string; action: string }) {
    const copy = moderationNoticeCopy(input.action);
    if (!copy) return null;
    const report = await prisma.communityModerationReport.findUnique({
      where: { id: input.reportId },
      select: { room: { select: { title: true } }, message: { select: { authorId: true } } },
    });
    const authorId = report?.message?.authorId;
    if (!report || !authorId) {
      this.logger.warn(`Moderation notice skipped for report ${input.reportId}: no message author`);
      return null;
    }
    return this.sendTargeted(
      {
        userIds: [authorId],
        category: "moderation",
        title: copy.title,
        body: copy.body(report.room.title),
        link: NOTICES_HELP_PATH,
      },
      MODERATION_ACTOR,
      { dedupeKey: `community_moderation_report:${input.reportId}` },
    );
  }
}

const APPEAL_SENTENCE =
  "There is no in-app appeal for community moderation yet; the help page explains what this notice means.";

export function moderationNoticeCopy(
  action: string,
): { title: string; body: (roomTitle: string) => string } | null {
  switch (action) {
    case "delete_message":
      return {
        title: "Your community message was removed",
        body: (room) =>
          `A message you posted in the community room "${room}" was removed by a moderator. ` +
          `Reason: it was reported and reviewed under the community guidelines. ${APPEAL_SENTENCE}`,
      };
    case "remove_member":
      return {
        title: "You were removed from a community room",
        body: (room) =>
          `A moderator removed you from the community room "${room}" after reviewing a reported message you posted. ` +
          `Reason: community guidelines. ${APPEAL_SENTENCE}`,
      };
    case "ban_member":
      return {
        title: "You were banned from a community room",
        body: (room) =>
          `A moderator banned you from the community room "${room}" after reviewing a reported message you posted. ` +
          `Reason: community guidelines. ${APPEAL_SENTENCE}`,
      };
    default:
      return null;
  }
}

function toNoticeDto(row: NoticeRow): NoticeDto {
  return {
    id: row.id,
    kind: row.recipientUserId ? "targeted" : "broadcast",
    category: row.category as NoticeCategory,
    title: row.title,
    body: row.body,
    link: row.link,
    effectiveAt: row.effectiveAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    readAt: row.reads[0]?.readAt.toISOString() ?? null,
  };
}
