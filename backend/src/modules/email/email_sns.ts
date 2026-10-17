import { createHash, timingSafeEqual } from "crypto";
import type { EmailWebhookEvent } from "./email_delivery.service";

/**
 * Pure helpers for the SNS-compatible bounce adapter (#2177): the envelope an
 * SNS-style topic POSTs to an HTTPS subscriber, the guard on the confirmation
 * URL, and one mapper per provider event format. Nothing here does I/O.
 */

/** Longest envelope accepted (SNS caps a message at 256 KiB). */
export const MAX_SNS_BODY_BYTES = 300 * 1024;
const MAX_EVENTS_PER_MESSAGE = 1000;
const MAX_EMAIL_LENGTH = 254;

export type SnsEnvelope =
  | { type: "SubscriptionConfirmation"; topicArn: string; subscribeUrl: string }
  | { type: "UnsubscribeConfirmation"; topicArn: string }
  | { type: "Notification"; topicArn: string; message: string };

/** Parse the JSON envelope. Returns `null` for anything malformed. */
export function parseSnsEnvelope(raw: string): SnsEnvelope | null {
  let body: unknown;
  try {
    body = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const b = body as Record<string, unknown>;
  if (typeof b.TopicArn !== "string" || !b.TopicArn) return null;
  const topicArn = b.TopicArn;
  switch (b.Type) {
    case "SubscriptionConfirmation":
      return typeof b.SubscribeURL === "string" && b.SubscribeURL
        ? { type: "SubscriptionConfirmation", topicArn, subscribeUrl: b.SubscribeURL }
        : null;
    case "UnsubscribeConfirmation":
      return { type: "UnsubscribeConfirmation", topicArn };
    case "Notification":
      return typeof b.Message === "string" ? { type: "Notification", topicArn, message: b.Message } : null;
    default:
      return null;
  }
}

/** Constant-time comparison of the path token with the configured one. */
export function snsTokenMatches(given: unknown, expected: string): boolean {
  if (typeof given !== "string" || !given || !expected) return false;
  // Hashing first gives equal lengths, so the comparison leaks nothing about length either.
  const a = createHash("sha256").update(given).digest();
  const b = createHash("sha256").update(expected).digest();
  return timingSafeEqual(a, b);
}

/**
 * A confirmation URL may be fetched only when it is plain HTTPS on the default
 * port, carries no credentials, its host is one of the allowlisted suffixes
 * (on a label boundary), and it confirms the configured topic. Anything else
 * would let a caller holding the path token make the API fetch an arbitrary URL.
 */
export function isAllowedSubscribeUrl(value: string, hostSuffixes: readonly string[], topicArn: string): boolean {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.port) return false;
  const host = url.hostname.toLowerCase();
  const hostAllowed = hostSuffixes.some((raw) => {
    const suffix = raw.trim().toLowerCase().replace(/^\.+/, "");
    return suffix.includes(".") && (host === suffix || host.endsWith(`.${suffix}`));
  });
  if (!hostAllowed) return false;
  const topic = url.searchParams.get("TopicArn");
  return topic === null || topic === topicArn;
}

export interface MappedSnsEvents {
  events: EmailWebhookEvent[];
  /** Provider events that are not a hard bounce or a complaint (delivered, queued, deferred, unknown). */
  ignored: number;
}

type SnsEventMapper = (message: unknown) => MappedSnsEvents | null;

function recipientOf(event: Record<string, unknown>): string | null {
  const email = event.email_to;
  return typeof email === "string" && email && email.length <= MAX_EMAIL_LENGTH ? email : null;
}

/**
 * Transactional email events published as `{ type, email_to, ... }`, one per
 * message (an array is accepted too). Permanent rejections become hard
 * bounces, spam reports complaints; deferred mail is retried by the provider,
 * which publishes a drop if it finally fails, so it is ignored like the rest.
 */
function mapTransactionalEmailEvents(message: unknown): MappedSnsEvents | null {
  const list = Array.isArray(message) ? message : [message];
  if (list.length > MAX_EVENTS_PER_MESSAGE) return null;
  const events: EmailWebhookEvent[] = [];
  let ignored = 0;
  for (const item of list) {
    if (!item || typeof item !== "object") return null;
    const event = item as Record<string, unknown>;
    if (typeof event.type !== "string") return null;
    const email = recipientOf(event);
    const mailboxNotFound = event.blocklist_type === "mailbox_not_found";
    if (email && (event.type === "email_dropped" || event.type === "email_mailbox_not_found")) {
      events.push({ type: "bounce", email, bounceType: "hard" });
    } else if (email && (event.type === "email_blocklisted" || event.type === "blocklist_created") && mailboxNotFound) {
      events.push({ type: "bounce", email, bounceType: "hard" });
    } else if (email && event.type === "email_spam") {
      events.push({ type: "complaint", email });
    } else {
      ignored += 1;
    }
  }
  return { events, ignored };
}

/**
 * Event formats `EMAIL_SNS_EVENT_FORMAT` can select. A deployment picks the one
 * its provider publishes; add a mapper here for a new provider.
 */
export const SNS_EVENT_MAPPERS: Readonly<Record<string, SnsEventMapper>> = {
  "scaleway-tem": mapTransactionalEmailEvents,
};

/** Parse a notification's `Message` and map it. `null` when it is not valid JSON or not that format. */
export function mapSnsMessage(format: string, message: string): MappedSnsEvents | null {
  const mapper = SNS_EVENT_MAPPERS[format];
  if (!mapper) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(message);
  } catch {
    return null;
  }
  return mapper(parsed);
}
