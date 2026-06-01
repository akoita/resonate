import { createHash, randomUUID } from "crypto";
import { z } from "zod";

export const ANALYTICS_ENVIRONMENTS = ["local", "dev", "staging", "prod"] as const;
export const ANALYTICS_PRIVACY_TIERS = ["anonymous", "pseudonymous", "personal", "sensitive"] as const;
export const ANALYTICS_GEO_SOURCES = ["user_declared", "ip_coarse", "campaign_target"] as const;
export const ANALYTICS_GEO_PRECISIONS = ["country", "region", "city"] as const;

export type AnalyticsEnvironment = (typeof ANALYTICS_ENVIRONMENTS)[number];
export type AnalyticsPrivacyTier = (typeof ANALYTICS_PRIVACY_TIERS)[number];
export type AnalyticsGeoSource = (typeof ANALYTICS_GEO_SOURCES)[number];
export type AnalyticsGeoPrecision = (typeof ANALYTICS_GEO_PRECISIONS)[number];

export interface AnalyticsGeoDimension {
  countryCode: string;
  regionCode?: string;
  citySlug?: string;
  source: AnalyticsGeoSource;
  precision: AnalyticsGeoPrecision;
}

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
  geo?: AnalyticsGeoDimension;
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
  geo?: AnalyticsGeoDimension;
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
    payloadFields: ["trackId", "artistId", "releaseId", "completionRatio", "durationMs", "source"],
  },
  {
    eventName: "playback.started",
    eventVersion: 1,
    producer: "playback-service",
    privacyTier: "pseudonymous",
    payloadFields: ["trackId", "artistId", "releaseId", "playbackInstanceId", "source"],
  },
  {
    eventName: "playback.heartbeat",
    eventVersion: 1,
    producer: "playback-service",
    privacyTier: "pseudonymous",
    payloadFields: ["trackId", "artistId", "releaseId", "playbackInstanceId", "positionMs", "durationMs"],
  },
  {
    eventName: "onboarding.step_completed",
    eventVersion: 1,
    producer: "web-app",
    privacyTier: "pseudonymous",
    payloadFields: ["step", "source"],
  },
  {
    eventName: "playlist.track_added",
    eventVersion: 1,
    producer: "web-app",
    privacyTier: "pseudonymous",
    payloadFields: ["playlistId", "trackId", "position", "source"],
  },
  {
    eventName: "artist.upload_step_completed",
    eventVersion: 1,
    producer: "web-app",
    privacyTier: "pseudonymous",
    payloadFields: ["step", "releaseId", "fileCount", "source"],
  },
  {
    eventName: "shows.pledge_intent_created",
    eventVersion: 1,
    producer: "shows-service",
    privacyTier: "pseudonymous",
    payloadFields: ["campaignId", "campaignSlug", "artistId", "amountUnits", "paymentAssetSymbol", "source"],
  },
  {
    eventName: "shows.campaign_visuals_updated",
    eventVersion: 1,
    producer: "shows-service",
    privacyTier: "pseudonymous",
    payloadFields: ["campaignId", "campaignSlug", "artistId", "visualAction", "visualSlots", "galleryVisualCount", "source"],
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
const analyticsGeoDimensionSchema = z
  .object({
    countryCode: z.string().regex(/^[A-Z]{2}$/, "countryCode must be ISO-3166 alpha-2"),
    regionCode: z.string().min(1).max(16).regex(/^[A-Z0-9-]+$/).optional(),
    citySlug: z.string().min(1).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).optional(),
    source: z.enum(ANALYTICS_GEO_SOURCES),
    precision: z.enum(ANALYTICS_GEO_PRECISIONS),
  })
  .strict();

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
    geo: analyticsGeoDimensionSchema.optional(),
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

    if (event.geo?.precision === "region" && !event.geo.regionCode) {
      ctx.addIssue({
        code: "custom",
        path: ["geo", "regionCode"],
        message: "region precision requires regionCode",
      });
    }

    if (event.geo?.precision === "city" && !event.geo.citySlug) {
      ctx.addIssue({
        code: "custom",
        path: ["geo", "citySlug"],
        message: "city precision requires citySlug",
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
    geo: normalizeAnalyticsGeoDimension(input.geo),
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

export function normalizeAnalyticsGeoDimension(input: unknown): AnalyticsGeoDimension | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }

  const record = input as Record<string, unknown>;
  const countryCode = normalizedCountryCode(record.countryCode);
  const regionCode = normalizedRegionCode(record.regionCode);
  const citySlug = normalizedCitySlug(record.citySlug);
  const source = normalizedGeoSource(record.source);
  const precision = normalizedGeoPrecision(record.precision);

  if (!countryCode || !source || !precision) {
    return undefined;
  }

  return {
    countryCode,
    regionCode,
    citySlug,
    source,
    precision,
  };
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

function normalizedCountryCode(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(normalized) ? normalized : undefined;
}

function normalizedRegionCode(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toUpperCase();
  return /^[A-Z0-9-]{1,16}$/.test(normalized) ? normalized : undefined;
}

function normalizedCitySlug(value: unknown) {
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return normalized || undefined;
}

function normalizedGeoSource(value: unknown): AnalyticsGeoSource | undefined {
  return typeof value === "string" && (ANALYTICS_GEO_SOURCES as readonly string[]).includes(value)
    ? (value as AnalyticsGeoSource)
    : undefined;
}

function normalizedGeoPrecision(value: unknown): AnalyticsGeoPrecision | undefined {
  return typeof value === "string" && (ANALYTICS_GEO_PRECISIONS as readonly string[]).includes(value)
    ? (value as AnalyticsGeoPrecision)
    : undefined;
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
