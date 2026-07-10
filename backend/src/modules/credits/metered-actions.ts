/**
 * Metered-action registry (#1422, RFC docs/rfc/usage-billing.md).
 *
 * Single typed source of truth for every AI action that consumes generation
 * credits and/or is throttled by a per-user rate limit. "Add a metered feature
 * tomorrow" should mean registering a `kind` here, not re-plumbing bespoke cost
 * and rate-limit descriptors into a new endpoint.
 *
 * IMPORTANT: the numbers here MIRROR the existing enforcement defaults — they do
 * NOT drive enforcement. Changing a value here does not change how the catalog
 * generation path (generation.service.ts DEFAULT_RATE_LIMIT / STRIKE_RATE_LIMIT)
 * or the remix path (remix-project.service.ts REMIX_GENERATION_RATE_LIMIT) throttle;
 * those keep their own env-driven config. Keep the two in sync: this registry is
 * the descriptor surface (labels + canonical defaults) the Usage & Billing
 * surface reads, while the services stay the authority on live remaining counts.
 * The canonical credit price stays in docs/rfc/business-model.md / the credits
 * service — it is deliberately not duplicated here.
 */
export type MeteredActionKind = "lyria" | "remix_draft";

export interface MeteredAction {
  kind: MeteredActionKind;
  /** Human-facing label shown on the Usage & Billing surface. */
  label: string;
  /** Credit cost is priced per this many seconds of generated audio. */
  costUnitSeconds: number;
  rateLimit: {
    /** Max actions per window (default; the service may override via env). */
    limit: number;
    /** Sliding-window length in milliseconds. */
    windowMs: number;
    /** Env var the enforcing service reads to override `limit`. */
    envKey: string;
  };
}

export const METERED_ACTIONS: Record<MeteredActionKind, MeteredAction> = {
  lyria: {
    kind: "lyria",
    label: "Track generation",
    costUnitSeconds: 30,
    rateLimit: { limit: 50, windowMs: 3_600_000, envKey: "STRIKE_RATE_LIMIT" },
  },
  remix_draft: {
    kind: "remix_draft",
    label: "AI remix draft",
    costUnitSeconds: 30,
    rateLimit: {
      limit: 10,
      windowMs: 3_600_000,
      envKey: "REMIX_GENERATION_RATE_LIMIT",
    },
  },
};
