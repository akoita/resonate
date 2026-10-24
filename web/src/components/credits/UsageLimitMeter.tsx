import type { UsageLimit } from "../../lib/api";
import { formatResetIn, formatWindow } from "../../lib/usage";

export interface UsageLimitMeterProps {
  /** The usage-limit window to show, or null while unknown / unavailable. */
  limit: UsageLimit | null;
  /** True while the usage summary is being fetched. */
  loading?: boolean;
  /**
   * `row` — full-width labelled bar (Settings → Usage & Billing).
   * `inline` — one compact line for the place a metered action happens
   * (Remix Studio create panel).
   */
  variant?: "row" | "inline";
  /** Reference time in ms; injectable for deterministic tests. */
  now?: number;
}

/**
 * Reusable, PURE presentational meter for ONE usage-limit window (#1422): how
 * much of a fair-use quota is left (% and count) and when it resets. It is the
 * sibling of `CreditBalanceMeter` and deliberately separate from it: running out
 * of a limit means waiting for the reset, never topping up credits. The parent
 * owns fetching (`GET /usage/summary`).
 */
export function UsageLimitMeter({
  limit,
  loading = false,
  variant = "row",
  now,
}: UsageLimitMeterProps) {
  if (!limit) {
    if (loading && variant === "inline") {
      return (
        <div className="usage-limit-meter-inline text-xs">
          <span className="text-zinc-500">Usage limit</span>{" "}
          <span className="text-zinc-400">Loading…</span>
        </div>
      );
    }
    return null;
  }

  const depleted = limit.remaining <= 0;
  const status = depleted ? "exhausted" : limit.percentLeft <= 20 ? "low" : "ok";
  const reset = formatResetIn(limit.resetsAt, now);
  const windowLabel = formatWindow(limit.windowSeconds);

  if (variant === "inline") {
    return (
      <div className="usage-limit-meter-inline text-xs" data-status={status}>
        <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
          <span className="text-zinc-500">{limit.label} limit</span>
          <span
            className="usage-limit-meter-value font-mono"
            data-depleted={depleted ? "true" : undefined}
            title={`${limit.remaining} of ${limit.limit} left per ${windowLabel}`}
          >
            {limit.percentLeft}% left
          </span>
          <span className="text-zinc-500">
            · {limit.remaining} of {limit.limit} per {windowLabel}
            {limit.resetsAt ? ` · ${reset}` : ""}
          </span>
        </div>
        {depleted && (
          <div className="mt-1 text-zinc-400 usage-limit-meter-note">
            Limit reached. This is a fair-use limit, not a credit balance: it frees up when the
            window resets.
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="usage-limit-row" data-status={status}>
      <div className="usage-limit-head">
        <span className="usage-limit-label">{limit.label}</span>
        <span className="usage-limit-count" data-depleted={depleted ? "true" : undefined}>
          {limit.percentLeft}% left · {limit.remaining} / {limit.limit} per {windowLabel}
        </span>
      </div>
      <div
        className="usage-limit-bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={limit.percentLeft}
        aria-label={`${limit.label} remaining`}
      >
        <div className="usage-limit-bar-fill" style={{ width: `${limit.percentLeft}%` }} />
      </div>
      <span className="usage-limit-reset">{reset}</span>
    </div>
  );
}

export default UsageLimitMeter;
