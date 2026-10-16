/**
 * Input validation for platform notices (#2146). Pure — no Prisma import — so
 * the controller can reject bad input before reaching the service, and the
 * service can re-check the same rules for server-side callers (#2147, #2149).
 */
import { BadRequestException } from "@nestjs/common";

export const NOTICE_CATEGORIES = [
  "policy",
  "terms",
  "incident",
  "moderation",
  "account",
  "refund",
] as const;
export type NoticeCategory = (typeof NOTICE_CATEGORIES)[number];

/**
 * Categories that are always emailed to a confirmed contact address (#2169):
 * `terms` is the legal notice of a terms change and `account` carries the
 * statement of reasons for an action on the person's account. Every other
 * category can be turned off for email. (In-app delivery is unaffected.)
 */
export const EMAIL_REQUIRED_NOTICE_CATEGORIES = ["terms", "account"] as const satisfies readonly NoticeCategory[];

export function isEmailRequiredCategory(category: string): boolean {
  return (EMAIL_REQUIRED_NOTICE_CATEGORIES as readonly string[]).includes(category);
}

/**
 * Roles a broadcast can target. `artist` is resolved from the person having an
 * artist profile (JWTs carry `listener` for artists); every other role is the
 * signed-in session's role.
 */
export const NOTICE_AUDIENCE_ROLES = ["listener", "artist", "operator", "admin"] as const;
export type NoticeAudienceRole = (typeof NOTICE_AUDIENCE_ROLES)[number];
export type BroadcastAudience = "all" | `role:${NoticeAudienceRole}`;

export const NOTICE_TITLE_MAX = 120;
export const NOTICE_BODY_MAX = 2000;
export const NOTICE_LINK_MAX = 300;
export const NOTICE_MAX_RECIPIENTS = 1000;

export interface TargetedNoticeInput {
  userIds: string[];
  category: NoticeCategory;
  title: string;
  body: string;
  link?: string | null;
}

export interface BroadcastNoticeInput {
  audience: BroadcastAudience;
  category: NoticeCategory;
  title: string;
  body: string;
  link?: string | null;
  effectiveAt?: Date | null;
  expiresAt?: Date | null;
}

function requireText(value: unknown, field: string, max: number): string {
  if (typeof value !== "string") throw new BadRequestException(`${field} must be a string`);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) {
    throw new BadRequestException(`${field} must be 1-${max} characters`);
  }
  return trimmed;
}

function parseCategory(value: unknown): NoticeCategory {
  if (typeof value !== "string" || !NOTICE_CATEGORIES.includes(value as NoticeCategory)) {
    throw new BadRequestException(`category must be one of: ${NOTICE_CATEGORIES.join(", ")}`);
  }
  return value as NoticeCategory;
}

/** An in-app path only: notices never link off-site. */
function parseLink(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new BadRequestException("link must be a string");
  const link = value.trim();
  if (link.length > NOTICE_LINK_MAX || !link.startsWith("/") || link.startsWith("//")) {
    throw new BadRequestException("link must be an in-app path starting with /");
  }
  return link;
}

function parseOptionalDate(value: unknown, field: string): Date | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" && !(value instanceof Date)) {
    throw new BadRequestException(`${field} must be an ISO date`);
  }
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new BadRequestException(`${field} must be an ISO date`);
  return date;
}

export function parseAudience(value: unknown): BroadcastAudience {
  if (value === "all") return "all";
  if (typeof value === "string" && value.startsWith("role:")) {
    const role = value.slice("role:".length);
    if (NOTICE_AUDIENCE_ROLES.includes(role as NoticeAudienceRole)) {
      return value as BroadcastAudience;
    }
  }
  throw new BadRequestException(
    `audience must be "all" or one of: ${NOTICE_AUDIENCE_ROLES.map((r) => `role:${r}`).join(", ")}`,
  );
}

export function parseTargetedNoticeInput(body: unknown): TargetedNoticeInput {
  const input = (body ?? {}) as Record<string, unknown>;
  if (!Array.isArray(input.userIds) || input.userIds.length === 0) {
    throw new BadRequestException("userIds must be a non-empty array");
  }
  if (input.userIds.length > NOTICE_MAX_RECIPIENTS) {
    throw new BadRequestException(`userIds may list at most ${NOTICE_MAX_RECIPIENTS} recipients per call`);
  }
  const userIds = Array.from(
    new Set(
      input.userIds.map((id) => {
        if (typeof id !== "string" || !id.trim() || id.length > 200) {
          throw new BadRequestException("every userId must be a non-empty string");
        }
        return id.trim();
      }),
    ),
  );
  return {
    userIds,
    category: parseCategory(input.category),
    title: requireText(input.title, "title", NOTICE_TITLE_MAX),
    body: requireText(input.body, "body", NOTICE_BODY_MAX),
    link: parseLink(input.link),
  };
}

export function parseBroadcastNoticeInput(body: unknown, now = new Date()): BroadcastNoticeInput {
  const input = (body ?? {}) as Record<string, unknown>;
  const expiresAt = parseOptionalDate(input.expiresAt, "expiresAt");
  if (expiresAt && expiresAt.getTime() <= now.getTime()) {
    throw new BadRequestException("expiresAt must be in the future");
  }
  return {
    audience: parseAudience(input.audience),
    category: parseCategory(input.category),
    title: requireText(input.title, "title", NOTICE_TITLE_MAX),
    body: requireText(input.body, "body", NOTICE_BODY_MAX),
    link: parseLink(input.link),
    effectiveAt: parseOptionalDate(input.effectiveAt, "effectiveAt"),
    expiresAt,
  };
}
