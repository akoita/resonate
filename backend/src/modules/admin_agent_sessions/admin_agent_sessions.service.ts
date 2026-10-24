import { BadRequestException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { writeAdminAuditEvent } from "../admin_audit/admin_audit_event";
import { AnalyticsGovernanceService } from "../analytics/analytics_governance.service";

/** Most events one view returns; a session produces far fewer in practice. */
export const AGENT_SESSION_EVENTS_LIMIT = 500;

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
/** A catalog, session or listing identifier: one token, no spaces. */
const IDENTIFIER = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/;
/** A reason / strategy / status code: lowercase tokens, never a sentence. */
const CODE = /^[a-z][a-z0-9_.:-]{0,63}$/;

const IDENTIFIER_FIELDS = ["trackId", "artistId", "releaseId", "listingId", "tokenId"] as const;
const CODE_FIELDS = [
  "reason",
  "strategy",
  "source",
  "transition",
  "licenseType",
  "curatedBy",
  "status",
  "runtimeStatus",
  "action",
  "seedKind",
  "mode",
] as const;
const COUNT_FIELDS = [
  "pickIndex",
  "pickCount",
  "trackCount",
  "shortfall",
  "count",
  "latencyMs",
  "amount",
  "priceUsd",
] as const;
const COVERAGE_FILTERS = ["genres", "moods", "energy", "bpm"] as const;
const UNMET_INTENT_KEYS = ["genres", "mood", "energy"] as const;

export type AgentEventCoverage = {
  picks: number;
  gaps: Array<{ filter: (typeof COVERAGE_FILTERS)[number]; matched: number }>;
  heldBack?: { variety: number; explicit: number };
  capRelaxed?: { artists: number };
  shortfallReason?: "catalog_short";
};

/**
 * One agent event as an operator sees it (#2259): identifiers, decisions,
 * coverage counts and reason codes. Built field by field from a whitelist, so a
 * typed sentence or any other free text in a stored payload cannot reach it.
 */
export type AgentSessionEventView = {
  id: string;
  eventName: string;
  occurredAt: string;
  producer: string;
  trackId?: string;
  artistId?: string;
  releaseId?: string;
  listingId?: string;
  tokenId?: string;
  reason?: string;
  strategy?: string;
  source?: string;
  transition?: string;
  licenseType?: string;
  curatedBy?: string;
  status?: string;
  runtimeStatus?: string;
  action?: string;
  seedKind?: string;
  mode?: string;
  pickIndex?: number;
  pickCount?: number;
  trackCount?: number;
  shortfall?: number;
  count?: number;
  candidateCount?: number;
  latencyMs?: number;
  amount?: number;
  priceUsd?: number;
  runtimeFallback?: { from: string; reason: string };
  /** Which parts of the request the catalog could not fill; never their values. */
  unmetIntent?: string[];
  coverage?: AgentEventCoverage;
  /** Fields that were present but not shaped like an identifier or a code, so were left out. */
  redactedFields?: string[];
};

export type AgentSessionEventsView = {
  sessionId: string;
  /** The session owner, when the session still exists. */
  userId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  events: AgentSessionEventView[];
  eventCount: number;
  /** True when the session has more events than the limit; the oldest are shown. */
  truncated: boolean;
  /** How long analytics events are kept (pseudonymous tier); older events are gone. */
  retentionDays: number;
};

type StoredEvent = {
  eventId: string;
  eventName: string;
  occurredAt: Date;
  createdAt: Date;
  producer: string;
  payload: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}

function coverageOf(value: unknown): AgentEventCoverage | undefined {
  const source = asRecord(value);
  const picks = count(source.picks);
  if (picks === undefined) return undefined;
  const gaps = (Array.isArray(source.gaps) ? source.gaps : []).flatMap((entry) => {
    const gap = asRecord(entry);
    const matched = count(gap.matched);
    const filter = COVERAGE_FILTERS.find((candidate) => candidate === gap.filter);
    return filter && matched !== undefined ? [{ filter, matched }] : [];
  });
  const coverage: AgentEventCoverage = { picks, gaps };
  const held = asRecord(source.heldBack);
  if (Object.keys(held).length > 0) {
    coverage.heldBack = { variety: count(held.variety) ?? 0, explicit: count(held.explicit) ?? 0 };
  }
  const relaxed = count(asRecord(source.capRelaxed).artists);
  if (relaxed !== undefined) coverage.capRelaxed = { artists: relaxed };
  if (source.shortfallReason === "catalog_short") coverage.shortfallReason = "catalog_short";
  return coverage;
}

/** Whitelists one stored event; exported for the unit-level specs. */
export function toAgentSessionEventView(event: StoredEvent): AgentSessionEventView {
  const payload = asRecord(event.payload);
  const view: AgentSessionEventView = {
    id: event.eventId,
    eventName: event.eventName,
    occurredAt: event.occurredAt.toISOString(),
    producer: event.producer,
  };
  const out = view as Record<string, unknown>;
  const redacted: string[] = [];

  for (const field of IDENTIFIER_FIELDS) {
    const raw = payload[field];
    if (raw === undefined || raw === null || raw === "") continue;
    const text = typeof raw === "number" ? String(raw) : raw;
    if (typeof text === "string" && IDENTIFIER.test(text)) out[field] = text;
    else redacted.push(field);
  }
  for (const field of CODE_FIELDS) {
    const raw = payload[field];
    if (raw === undefined || raw === null || raw === "") continue;
    if (typeof raw === "string" && CODE.test(raw)) out[field] = raw;
    else redacted.push(field);
  }
  for (const field of COUNT_FIELDS) {
    const value = count(payload[field]);
    if (value !== undefined) out[field] = value;
  }
  if (Array.isArray(payload.candidates)) view.candidateCount = payload.candidates.length;

  const fallback = asRecord(payload.runtimeFallback);
  if (typeof fallback.from === "string" && CODE.test(fallback.from) && typeof fallback.reason === "string" && CODE.test(fallback.reason)) {
    view.runtimeFallback = { from: fallback.from, reason: fallback.reason };
  }
  // Stored as a list of keys (#2337); events recorded before that hold an object.
  const unmetRaw = payload.unmetIntent;
  const unmet = asRecord(unmetRaw);
  const unmetKeys = UNMET_INTENT_KEYS.filter((key) =>
    Array.isArray(unmetRaw) ? unmetRaw.includes(key) : unmet[key] !== undefined && unmet[key] !== null,
  );
  if (unmetKeys.length > 0) view.unmetIntent = [...unmetKeys];
  const coverage = coverageOf(payload.coverage);
  if (coverage) view.coverage = coverage;
  if (redacted.length > 0) view.redactedFields = redacted;
  return view;
}

/** Oldest first; within one batch the picks follow their position, then storage order. */
function compareEvents(a: StoredEvent, b: StoredEvent): number {
  const byTime = a.occurredAt.getTime() - b.occurredAt.getTime();
  if (byTime !== 0) return byTime;
  const pickA = count(asRecord(a.payload).pickIndex);
  const pickB = count(asRecord(b.payload).pickIndex);
  if (pickA !== undefined && pickB !== undefined && pickA !== pickB) return pickA - pickB;
  const byCreated = a.createdAt.getTime() - b.createdAt.getTime();
  return byCreated !== 0 ? byCreated : a.eventId.localeCompare(b.eventId);
}

/**
 * Operator view of one AI DJ session's raw agent events (#2259).
 *
 * Reads the analytics events the runtime already records (`agent.*` for the
 * session): no second store, and the events expire with the analytics
 * retention policy. Every successful read writes an `AdminAuditEvent` before
 * anything is returned.
 */
@Injectable()
export class AdminAgentSessionsService {
  constructor(private readonly governance: AnalyticsGovernanceService) {}

  async events(actorUserId: string, sessionId: string): Promise<AgentSessionEventsView> {
    if (!SESSION_ID.test(sessionId)) throw new BadRequestException("Invalid session id");

    const [session, stored] = await Promise.all([
      prisma.session.findUnique({
        where: { id: sessionId },
        select: { id: true, userId: true, startedAt: true, endedAt: true },
      }),
      prisma.analyticsEvent.findMany({
        where: { sessionId, eventName: { startsWith: "agent." } },
        orderBy: [{ occurredAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
        take: AGENT_SESSION_EVENTS_LIMIT + 1,
        select: {
          eventId: true,
          eventName: true,
          occurredAt: true,
          createdAt: true,
          producer: true,
          payload: true,
        },
      }),
    ]);
    if (!session && stored.length === 0) throw new NotFoundException("Session not found");

    const truncated = stored.length > AGENT_SESSION_EVENTS_LIMIT;
    const events = stored.slice(0, AGENT_SESSION_EVENTS_LIMIT).sort(compareEvents).map(toAgentSessionEventView);

    // Logged before anything is returned: an operator never sees events whose
    // access was not recorded. Identifiers and a count only, never the payload.
    await writeAdminAuditEvent(
      {
        actorUserId,
        action: "agent_session.events_viewed",
        targetUserId: session?.userId ?? null,
        detail: { sessionId, eventCount: events.length },
      },
      { required: true },
    );

    return {
      sessionId,
      userId: session?.userId ?? null,
      startedAt: session?.startedAt.toISOString() ?? null,
      endedAt: session?.endedAt?.toISOString() ?? null,
      events,
      eventCount: events.length,
      truncated,
      retentionDays: this.governance.getRetentionPolicy().pseudonymousDays,
    };
  }
}
