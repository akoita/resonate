/**
 * Metered-action registry (#1422, RFC docs/rfc/usage-billing.md).
 *
 * Single typed source of truth for every AI action that consumes generation
 * credits and/or is throttled by a per-user rate limit. "Add a metered feature
 * tomorrow" means registering a `kind` here, not re-plumbing bespoke cost,
 * ledger-reason and rate-limit descriptors into a new endpoint.
 *
 * The registry is READ by the enforcing code, not merely mirrored from it:
 *   - the debit sites use `LEDGER_REASON` for the ledger `reason` they write,
 *     and `defaultDurationSeconds` for the duration they price when the caller
 *     gives none;
 *   - the rate-limit enforcers (generation.service.ts, remix-project.service.ts)
 *     take their default limit, window and env override key from `rateLimit`
 *     via `resolveRateLimit`;
 *   - the Usage & Billing aggregation derives per-unit cost from the live price
 *     with `unitCostCents`, which applies the same formula as
 *     `GenerationCreditsService.costForDurationCents` (parity is pinned by
 *     metered-actions.spec.ts).
 *
 * The canonical credit PRICE is deliberately not defined here: it stays in
 * docs/rfc/business-model.md (ADR-BM-3) and the credits service
 * (`GENERATION_PRICE_CENTS_PER_30S`). The registry holds only unit sizes; a
 * per-unit cost is always `unitCostCents(kind, livePriceCentsPer30s)`.
 */
export type MeteredActionKind = "lyria" | "remix_draft";

/**
 * The `reason` written on a `debit` ledger row, per debit site. The ledger has
 * no `kind` column, so the reason is how the usage breakdown attributes spend
 * to a kind (see `ledgerReasons` on each registry entry).
 */
export const LEDGER_REASON = {
  lyriaGeneration: "lyria_generation",
  remixDraft: "remix_draft",
  remixPart: "remix_part",
} as const;

/** One hour, the window both current rate limits use. */
export const METERED_WINDOW_HOUR_MS = 60 * 60 * 1000;

/** Default max catalog (Lyria) generations per user per hour. */
export const DEFAULT_LYRIA_RATE_LIMIT = 50;

/** Default max Remix Studio AI drafts per user per hour. */
export const DEFAULT_REMIX_GENERATION_RATE_LIMIT = 10;

/** The size of one billable block; the credit price is quoted per this. */
export const PRICE_UNIT_SECONDS = 30;

export interface MeteredAction {
  kind: MeteredActionKind;
  /** Human-facing label shown on the Usage & Billing surface. */
  label: string;
  /** Debit-ledger `reason` values that count as this kind's spend. */
  ledgerReasons: readonly string[];
  cost: {
    /** One billable unit is this many seconds of generated audio. */
    unitSeconds: number;
    /** Duration priced when the caller does not specify one. */
    defaultDurationSeconds: number;
  };
  /** Optional usage-limit window; omit for a kind with no fair-use limit. */
  rateLimit?: {
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
    ledgerReasons: [LEDGER_REASON.lyriaGeneration],
    cost: { unitSeconds: PRICE_UNIT_SECONDS, defaultDurationSeconds: 30 },
    rateLimit: {
      limit: DEFAULT_LYRIA_RATE_LIMIT,
      windowMs: METERED_WINDOW_HOUR_MS,
      envKey: "STRIKE_RATE_LIMIT",
    },
  },
  remix_draft: {
    kind: "remix_draft",
    label: "AI remix draft",
    // Part takes (#1901) are debited under kind `remix_draft` too.
    ledgerReasons: [LEDGER_REASON.remixDraft, LEDGER_REASON.remixPart],
    cost: { unitSeconds: PRICE_UNIT_SECONDS, defaultDurationSeconds: 30 },
    rateLimit: {
      limit: DEFAULT_REMIX_GENERATION_RATE_LIMIT,
      windowMs: METERED_WINDOW_HOUR_MS,
      envKey: "REMIX_GENERATION_RATE_LIMIT",
    },
  },
};

export const METERED_ACTION_KINDS = Object.keys(
  METERED_ACTIONS,
) as MeteredActionKind[];

/**
 * Cost in USD cents of ONE unit of `kind` at the live price. The formula is
 * `ceil((unitSeconds / 30) * priceCentsPer30s)` — identical to
 * `GenerationCreditsService.costForDurationCents(unitSeconds)`, so a unit price
 * quoted here is exactly what a debit of that duration charges.
 */
export function unitCostCents(
  kind: MeteredActionKind,
  priceCentsPer30s: number,
): number {
  return Math.ceil(
    (METERED_ACTIONS[kind].cost.unitSeconds / PRICE_UNIT_SECONDS) *
      priceCentsPer30s,
  );
}

/**
 * Resolve a kind's usage-limit max: a positive integer from `raw` (a config /
 * env value, number or numeric string) when valid, else the registry default.
 * Returns null for a kind that declares no usage limit.
 */
export function resolveRateLimit(
  kind: MeteredActionKind,
  raw?: string | number | null,
): { limit: number; windowMs: number } | null {
  const spec = METERED_ACTIONS[kind].rateLimit;
  if (!spec) return null;
  const parsed = typeof raw === "string" ? Number.parseInt(raw, 10) : raw;
  const limit =
    typeof parsed === "number" && Number.isFinite(parsed) && parsed > 0
      ? Math.floor(parsed)
      : spec.limit;
  return { limit, windowMs: spec.windowMs };
}
