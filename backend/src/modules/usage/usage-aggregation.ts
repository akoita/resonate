import {
  METERED_ACTIONS,
  METERED_ACTION_KINDS,
  unitCostCents,
  type MeteredActionKind,
} from "../credits/metered-actions";

/** Rolling window the per-kind breakdown covers. */
export const USAGE_BREAKDOWN_PERIOD_DAYS = 30;

/** One usage-limit row in the unified summary (#1422). */
export interface UsageLimitSummary {
  kind: MeteredActionKind;
  label: string;
  remaining: number;
  limit: number;
  /** 0-100, rounded: how much of the window's quota is still available. */
  percentLeft: number;
  windowSeconds: number;
  /** ISO timestamp; null when no requests are recorded in the window. */
  resetsAt: string | null;
}

/** Credit spend attributed to one metered kind over the breakdown period. */
export interface UsageBreakdownItem {
  kind: MeteredActionKind;
  label: string;
  /** Registry unit size: one charge covers this many seconds of audio. */
  unitSeconds: number;
  /** Live credit cost of one unit, in cents (registry x live price). */
  unitCostCents: number;
  /** Number of debits (charged actions) in the period. */
  charges: number;
  spentCents: number;
  /** Credits returned for failed runs of this kind. */
  refundedCents: number;
  /** spentCents - refundedCents: what the kind actually cost the user. */
  netCents: number;
}

export interface UsageBreakdown {
  periodDays: number;
  /** ISO timestamp the period starts at. */
  since: string;
  items: UsageBreakdownItem[];
}

/** Side-effect-free peek at an enforcing service's sliding window. */
export interface RateLimitPeek {
  remaining: number;
  limit: number;
  windowMs: number;
  resetsAt: Date | null;
}

export function percentLeft(remaining: number, limit: number): number {
  if (!(limit > 0)) return 0;
  return Math.max(0, Math.min(100, Math.round((remaining / limit) * 100)));
}

/**
 * Usage-limit rows for every registered kind that declares a window, in
 * registry order. A kind with no `rateLimit` is skipped; a kind whose peek is
 * missing is skipped too (it cannot report a live count).
 */
export function buildUsageLimits(
  peeks: Partial<Record<MeteredActionKind, RateLimitPeek>>,
): UsageLimitSummary[] {
  const rows: UsageLimitSummary[] = [];
  for (const kind of METERED_ACTION_KINDS) {
    const action = METERED_ACTIONS[kind];
    const peek = peeks[kind];
    if (!action.rateLimit || !peek) continue;
    rows.push({
      kind,
      label: action.label,
      remaining: peek.remaining,
      limit: peek.limit,
      percentLeft: percentLeft(peek.remaining, peek.limit),
      windowSeconds: Math.round(peek.windowMs / 1000),
      resetsAt: peek.resetsAt ? peek.resetsAt.toISOString() : null,
    });
  }
  return rows;
}

/** Debit ledger rows grouped by `reason` (count + summed cents). */
export interface DebitGroup {
  reason: string;
  count: number;
  amountCents: number;
}

/** A refund row, with the `reason` of the debit it returns (if known). */
export interface RefundRow {
  amountCents: number;
  debitReason: string | null;
}

/**
 * Per-kind spend breakdown. Every registered kind gets a row (zeros when unused)
 * so the UI shows what is metered, not just what was used. Debits are attributed
 * to a kind by `ledgerReasons`; refunds by the reason of the debit they undo.
 * Ledger rows whose reason matches no registered kind are ignored here — they
 * still appear in the credit ledger history.
 */
export function buildUsageBreakdown(input: {
  debits: DebitGroup[];
  refunds: RefundRow[];
  priceCentsPer30s: number;
  since: Date;
  periodDays?: number;
}): UsageBreakdown {
  const kindByReason = new Map<string, MeteredActionKind>();
  for (const kind of METERED_ACTION_KINDS) {
    for (const reason of METERED_ACTIONS[kind].ledgerReasons) {
      kindByReason.set(reason, kind);
    }
  }

  const items = new Map<MeteredActionKind, UsageBreakdownItem>();
  for (const kind of METERED_ACTION_KINDS) {
    const action = METERED_ACTIONS[kind];
    items.set(kind, {
      kind,
      label: action.label,
      unitSeconds: action.cost.unitSeconds,
      unitCostCents: unitCostCents(kind, input.priceCentsPer30s),
      charges: 0,
      spentCents: 0,
      refundedCents: 0,
      netCents: 0,
    });
  }

  for (const group of input.debits) {
    const kind = kindByReason.get(group.reason);
    const item = kind ? items.get(kind) : undefined;
    if (!item) continue;
    item.charges += group.count;
    item.spentCents += group.amountCents;
  }
  for (const refund of input.refunds) {
    const kind = refund.debitReason
      ? kindByReason.get(refund.debitReason)
      : undefined;
    const item = kind ? items.get(kind) : undefined;
    if (!item) continue;
    item.refundedCents += refund.amountCents;
  }
  for (const item of items.values()) {
    item.netCents = item.spentCents - item.refundedCents;
  }

  return {
    periodDays: input.periodDays ?? USAGE_BREAKDOWN_PERIOD_DAYS,
    since: input.since.toISOString(),
    items: METERED_ACTION_KINDS.map((kind) => items.get(kind)!),
  };
}
