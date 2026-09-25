import type { GenerationCreditBalance } from "../../lib/api";
import { formatCreditCapacity } from "../../lib/credits";

export interface CreditBalanceMeterProps {
  /** The caller's credit balance, or null while it is unknown / loading. */
  balance: GenerationCreditBalance | null;
  /** True while the balance is being fetched (shows a placeholder for `panel` and `inline`). */
  loading?: boolean;
  /**
   * When provided AND the balance is empty/low, renders a "Request credits from
   * an operator" affordance (#1418) that calls this handler.
   */
  onRequestCredits?: () => void;
  /** Disables the request affordance while a request is in flight. */
  requesting?: boolean;
  /**
   * `strip` — compact inline cell for the Create-page analytics strip.
   * `panel` — bordered standalone block.
   * `inline` — one compact row for the Remix Studio Create panel.
   */
  variant?: "strip" | "panel" | "inline";
  /**
   * `inline` only: generation price per 30 s block in cents. When given,
   * the row ends with "· $0.10 per 30 s".
   */
  priceCentsPer30s?: number | null;
}

/** "$0.10 per 30 s", or null when the price is unknown or invalid. */
export function formatPricePer30s(priceCentsPer30s: number | null | undefined): string | null {
  if (
    typeof priceCentsPer30s !== "number" ||
    !Number.isFinite(priceCentsPer30s) ||
    priceCentsPer30s < 0
  ) {
    return null;
  }
  return `$${(priceCentsPer30s / 100).toFixed(2)} per 30 s`;
}

export const CREDIT_METER_EMPTY_NOTE = "AI drafts need generation credits.";
export const CREDIT_METER_LOW_NOTE = "You're running low on generation credits.";

/**
 * Reusable, PURE presentational credit meter (#1422, WI-B). The parent owns
 * fetching and passes the balance in, so this component is testable via
 * `renderToStaticMarkup`. Renders remaining generation capacity as
 * "≈ X min · Y tracks" (see `formatCreditCapacity`), an empty/low state, a
 * raw-cents tooltip, and — when `onRequestCredits` is given and the balance is
 * empty/low — the operator top-up request affordance.
 */
export function CreditBalanceMeter({
  balance,
  loading = false,
  onRequestCredits,
  requesting = false,
  variant = "strip",
  priceCentsPer30s,
}: CreditBalanceMeterProps) {
  if (!balance) {
    if (loading && variant === "inline") {
      return (
        <div className="remix-credit-meter-inline flex items-baseline gap-2 text-xs">
          <span className="text-zinc-500">Credits</span>
          <span className="text-zinc-400">Loading…</span>
        </div>
      );
    }
    // Nothing to show yet. The panel and inline row offer a loading placeholder;
    // the strip stays silent so it never reserves an empty cell.
    if (loading && variant === "panel") {
      return (
        <div className="remix-credit-meter border border-zinc-800 rounded-lg p-4 bg-zinc-950">
          <span className="text-xs uppercase tracking-wide text-zinc-500">
            Generation credits
          </span>
          <span className="block text-sm text-zinc-400 mt-1">Loading…</span>
        </div>
      );
    }
    return null;
  }

  const cap = formatCreditCapacity(balance.balanceCents, balance.priceCentsPer30s);
  const status = cap.empty ? "exhausted" : cap.low ? "low" : "ok";
  const capacityText = cap.empty ? "0 — top up" : `≈ ${cap.minLabel} min · ${cap.tracks} tracks`;
  const tooltip = `${balance.balanceCents}¢ remaining · ~${cap.tracks} × 1-min tracks`;
  const showRequest = !!onRequestCredits && (cap.empty || cap.low);

  if (variant === "strip") {
    return (
      <div className="create-analytics-item">
        <span className="create-analytics-label">Credits</span>
        <span className={`create-analytics-value rate-status ${status}`} title={tooltip}>
          {capacityText}
        </span>
        {showRequest && (
          <button
            type="button"
            className="credit-meter-request-btn"
            onClick={onRequestCredits}
            disabled={requesting}
          >
            {requesting ? "Sending…" : "📨 Request credits"}
          </button>
        )}
      </div>
    );
  }

  const valueColor =
    status === "exhausted"
      ? "text-red-300"
      : status === "low"
        ? "text-amber-300"
        : "text-emerald-300";

  if (variant === "inline") {
    const price = formatPricePer30s(priceCentsPer30s);
    return (
      <div className="remix-credit-meter-inline text-xs" data-status={status}>
        <div className="flex items-baseline gap-x-2 gap-y-0.5 flex-wrap">
          <span className="text-zinc-500">Credits</span>
          <span className={`remix-credit-meter-value font-mono ${valueColor}`} title={tooltip}>
            {capacityText}
          </span>
          {price && (
            <span className="text-zinc-500 remix-credit-meter-price">· {price}</span>
          )}
        </div>
        {(cap.empty || cap.low) && (
          <div className="mt-1.5 flex items-center gap-x-2 gap-y-1 flex-wrap remix-credit-meter-note">
            <span className="text-zinc-400">
              {cap.empty ? CREDIT_METER_EMPTY_NOTE : CREDIT_METER_LOW_NOTE}
            </span>
            {showRequest && (
              <button
                type="button"
                className="ui-btn ui-btn-ghost ui-btn-sm remix-credit-meter-request-btn"
                onClick={onRequestCredits}
                disabled={requesting}
              >
                {requesting ? "Sending…" : "Request credits"}
              </button>
            )}
          </div>
        )}
      </div>
    );
  }

  return (
    <div
      className="remix-credit-meter border border-zinc-800 rounded-lg p-4 bg-zinc-950"
      data-status={status}
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <span className="text-xs uppercase tracking-wide text-zinc-500">
          Generation credits
        </span>
        <span
          className={`remix-credit-meter-value text-sm font-mono ${valueColor}`}
          title={tooltip}
        >
          {capacityText}
        </span>
      </div>
      {showRequest && (
        <div className="mt-3">
          <p className="text-xs text-zinc-400 mb-2 max-w-[22rem]">
            {cap.empty
              ? "You're out of generation credits. Remix drafts won't render until you top up."
              : "You're low on generation credits."}
          </p>
          <button
            type="button"
            className="ui-btn ui-btn-ghost credit-meter-request-btn"
            onClick={onRequestCredits}
            disabled={requesting}
          >
            {requesting ? "Sending…" : "📨 Request credits from an operator"}
          </button>
        </div>
      )}
    </div>
  );
}

export default CreditBalanceMeter;
