import { createHash, randomUUID } from "crypto";
import { z } from "zod";

export const ANALYTICS_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;
export const ANALYTICS_PRIVACY_TIERS = ["anonymous", "pseudonymous", "personal", "sensitive"] as const;

export type AnalyticsEnvironment = (typeof ANALYTICS_ENVIRONMENTS)[number];
export type AnalyticsPrivacyTier = (typeof ANALYTICS_PRIVACY_TIERS)[number];

export interface AnalyticsEventEnvelope {
  eventId: string;
  eventName: string;
  eventVersion: number;
  occurredAt: string;
  receivedAt: string;
  producer: string;
  environment: AnalyticsEnvironment;
  privacyTier: AnalyticsPrivacyTier;
  subjectType?: string;
  subjectId?: string;
  actorId?: string;
  sessionId?: string;
  traceId?: string;
  schemaUri?: string;
  consentBasis?: string;
  payload: Record<string, unknown>;
  sourceRefs?: Record<string, string>;
}

export type AnalyticsEventInput = Partial<AnalyticsEventEnvelope> & {
  eventName?: string;
  event_name?: string;
  eventId?: string;
  event_id?: string;
  eventVersion?: number;
  event_version?: number;
  occurredAt?: string;
  occurred_at?: string;
  receivedAt?: string;
  received_at?: string;
  privacyTier?: AnalyticsPrivacyTier;
  privacy_tier?: AnalyticsPrivacyTier;
  subjectType?: string;
  subject_type?: string;
  subjectId?: string;
  subject_id?: string;
  actorId?: string;
  actor_id?: string;
  sessionId?: string;
  session_id?: string;
  traceId?: string;
  trace_id?: string;
  schemaUri?: string;
  schema_uri?: string;
  consentBasis?: string;
  consent_basis?: string;
  sourceRefs?: Record<string, string>;
  source_refs?: Record<string, string>;
  payload?: Record<string, unknown>;
};

export class AnalyticsEventValidationError extends Error {
  constructor(readonly issues: string[]) {
    super(`Invalid analytics event: ${issues.join("; ")}`);
    this.name = "AnalyticsEventValidationError";
  }
}

export const ANALYTICS_EVENT_SCHEMA_EXAMPLES = [
  {
    eventName: "playback.completed",
    eventVersion: 1,
    producer: "playback-service",
    privacyTier: "pseudonymous",
    payloadFields: ["trackId", "artistId", "completionRatio", "durationMs", "source"],
  },
  {
    eventName: "commerce.settled",
    eventVersion: 1,
    producer: "payments-service",
    privacyTier: "pseudonymous",
    payloadFields: ["paymentId", "trackId", "artistId", "canonicalAmountUsd", "settlementAsset"],
  },
  {
    eventName: "rights.route_decided",
    eventVersion: 1,
    producer: "rights-service",
    privacyTier: "pseudonymous",
    payloadFields: ["releaseId", "artistId", "route", "evidenceTypes", "decisionReason"],
  },
  {
    eventName: "agent.recommendation_selected",
    eventVersion: 1,
    producer: "agent-runtime",
    privacyTier: "pseudonymous",
    payloadFields: ["agentId", "sessionId", "trackId", "strategy", "candidateCount"],
  },
  {
    eventName: "generation.created",
    eventVersion: 1,
    producer: "generation-service",
    privacyTier: "personal",
    payloadFields: ["generationId", "userId", "trackId", "model", "promptPolicy"],
  },
  {
    eventName: "recommendation.generated",
    eventVersion: 1,
    producer: "recommendations-service",
    privacyTier: "pseudonymous",
    payloadFields: ["userCohortId", "trackIds", "strategy", "candidateCount"],
  },
  {
    eventName: "stems.uploaded",
    eventVersion: 1,
    producer: "ingestion-service",
    privacyTier: "pseudonymous",
    payloadFields: ["releaseId", "artistId", "sourceType", "trackIds", "trackCount", "stemCount"],
  },
  {
    eventName: "stems.processed",
    eventVersion: 1,
    producer: "ingestion-service",
    privacyTier: "pseudonymous",
    payloadFields: ["releaseId", "trackId", "stemIds", "modelVersion", "durationMs"],
  },
  {
    eventName: "catalog.track_status",
    eventVersion: 1,
    producer: "catalog-service",
    privacyTier: "pseudonymous",
    payloadFields: ["releaseId", "trackId", "status", "error"],
  },
  {
    eventName: "catalog.release_ready",
    eventVersion: 1,
    producer: "catalog-service",
    privacyTier: "pseudonymous",
    payloadFields: ["releaseId", "artistId", "status", "trackIds", "trackCount", "stemCount"],
  },
] as const;

const analyticsEventNameSchema = z
  .string()
  .min(3)
  .max(120)
  .regex(/^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/, "must use dotted lowercase names such as playback.completed");

const analyticsIdentifierSchema = z.string().min(1).max(200);

export const analyticsEventEnvelopeSchema = z
  .object({
    eventId: z.string().min(1).max(200),
    eventName: analyticsEventNameSchema,
    eventVersion: z.number().int().positive(),
    occurredAt: z.string().datetime(),
    receivedAt: z.string().datetime(),
    producer: z.string().min(1).max(120),
    environment: z.enum(ANALYTICS_ENVIRONMENTS),
    privacyTier: z.enum(ANALYTICS_PRIVACY_TIERS),
    subjectType: analyticsIdentifierSchema.optional(),
    subjectId: analyticsIdentifierSchema.optional(),
    actorId: analyticsIdentifierSchema.optional(),
    sessionId: analyticsIdentifierSchema.optional(),
    traceId: analyticsIdentifierSchema.optional(),
    schemaUri: analyticsIdentifierSchema.optional(),
    consentBasis: analyticsIdentifierSchema.optional(),
    payload: z.record(z.string(), z.unknown()),
    sourceRefs: z.record(z.string(), z.string()).optional(),
  })
  .superRefine((event, ctx) => {
    if ((event.subjectType && !event.subjectId) || (!event.subjectType && event.subjectId)) {
      ctx.addIssue({
        code: "custom",
        path: ["subjectId"],
        message: "subjectType and subjectId must be provided together",
      });
    }

    if ((event.privacyTier === "personal" || event.privacyTier === "sensitive") && !event.consentBasis) {
      ctx.addIssue({
        code: "custom",
        path: ["consentBasis"],
        message: "personal and sensitive analytics events require consentBasis",
      });
    }
  });

export function parseAnalyticsEventEnvelope(input: unknown): AnalyticsEventEnvelope {
  const result = analyticsEventEnvelopeSchema.safeParse(input);
  if (result.success) {
    return result.data;
  }

  throw new AnalyticsEventValidationError(
    result.error.issues.map((issue) => {
      const path = issue.path.length ? `${issue.path.join(".")}: ` : "";
      return `${path}${issue.message}`;
    }),
  );
}

export function normalizeAnalyticsEventInput(
  input: AnalyticsEventInput,
  options?: {
    now?: Date;
    defaultProducer?: string;
    defaultEnvironment?: AnalyticsEnvironment;
    defaultPrivacyTier?: AnalyticsPrivacyTier;
  },
): AnalyticsEventEnvelope {
  const now = options?.now ?? new Date();
  const receivedAt = input.receivedAt ?? input.received_at ?? now.toISOString();
  const occurredAt = input.occurredAt ?? input.occurred_at ?? receivedAt;
  const eventName = input.eventName ?? input.event_name;
  const eventVersion = input.eventVersion ?? input.event_version ?? 1;
  const producer = input.producer ?? options?.defaultProducer ?? "analytics-api";
  const environment = input.environment ?? options?.defaultEnvironment ?? defaultAnalyticsEnvironment();
  const privacyTier = input.privacyTier ?? input.privacy_tier ?? options?.defaultPrivacyTier ?? "pseudonymous";
  const sourceRefs = input.sourceRefs ?? input.source_refs;
  const schemaUri = input.schemaUri ?? input.schema_uri ?? (eventName ? `analytics://${eventName}/v${eventVersion}` : undefined);

  const event = {
    eventId:
      input.eventId ??
      input.event_id ??
      buildAnalyticsEventId({
        eventName,
        eventVersion,
        occurredAt,
        producer,
        sourceRefs,
      }),
    eventName,
    eventVersion,
    occurredAt,
    receivedAt,
    producer,
    environment,
    privacyTier,
    subjectType: input.subjectType ?? input.subject_type,
    subjectId: input.subjectId ?? input.subject_id,
    actorId: input.actorId ?? input.actor_id,
    sessionId: input.sessionId ?? input.session_id,
    traceId: input.traceId ?? input.trace_id,
    schemaUri,
    consentBasis: input.consentBasis ?? input.consent_basis,
    payload: input.payload,
    sourceRefs,
  };

  return parseAnalyticsEventEnvelope(event);
}

export function buildAnalyticsEventId(input: {
  eventName?: string;
  eventVersion?: number;
  occurredAt?: string;
  producer?: string;
  sourceRefs?: Record<string, string>;
}) {
  if (
    !input.eventName ||
    !input.occurredAt ||
    !input.producer ||
    !input.sourceRefs ||
    Object.keys(input.sourceRefs).length === 0
  ) {
    return `evt_${randomUUID()}`;
  }

  const hash = createHash("sha256")
    .update(
      stableStringify({
        eventName: input.eventName,
        eventVersion: input.eventVersion ?? 1,
        occurredAt: input.occurredAt,
        producer: input.producer,
        sourceRefs: input.sourceRefs ?? {},
      }),
    )
    .digest("hex")
    .slice(0, 32);

  return `evt_${hash}`;
}

export function defaultAnalyticsEnvironment(): AnalyticsEnvironment {
  if (process.env.NODE_ENV === "production") {
    return "prod";
  }
  if (process.env.NODE_ENV === "test") {
    return "local";
  }
  return "dev";
}

function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
