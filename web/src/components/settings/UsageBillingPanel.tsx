"use client";

import { useEffect, useState } from "react";
import { getUsageSummary, requestGenerationCredits, type UsageSummary } from "../../lib/api";
import { CreditBalanceMeter } from "../credits/CreditBalanceMeter";
import { Button } from "../ui/Button";

type ToastFn = (toast: {
  type: "success" | "error" | "info" | "warning";
  title: string;
  message: string;
}) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

type CreditRequestState = "idle" | "sending" | "sent";

/**
 * Human-readable "resets in …" label from an ISO timestamp (#1422). Pure so it
 * is unit-testable. Returns "—" when there is no active window (`resetsAt` is
 * null), "now" when the window has already lapsed, and otherwise a coarse
 * relative span like "in 42 min" or "in 2 h 5 min".
 *
 * @param resetsAt ISO timestamp, or null when the limiter is idle.
 * @param now      Reference time in ms (defaults to `Date.now()`); injectable
 *                 for deterministic tests.
 */
export function formatResetIn(resetsAt: string | null, now: number = Date.now()): string {
  if (!resetsAt) return "—";
  const target = new Date(resetsAt).getTime();
  if (Number.isNaN(target)) return "—";
  const deltaMs = target - now;
  if (deltaMs <= 0) return "resets now";
  const totalMinutes = Math.ceil(deltaMs / 60_000);
  if (totalMinutes < 60) return `resets in ${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return remHours > 0 ? `resets in ${days}d ${remHours}h` : `resets in ${days}d`;
  }
  return minutes > 0 ? `resets in ${hours}h ${minutes}min` : `resets in ${hours}h`;
}

/**
 * Format a ledger amount in cents, signed by transaction type (#1422). Debits
 * (spend) render negative; everything else (grant/top-up/refund) renders
 * positive so the sign matches the running balance.
 */
export function formatLedgerAmount(type: string, amountCents: number): string {
  const magnitude = Math.abs(amountCents);
  const isDebit = /debit|spend|charge|consume/i.test(type);
  const sign = isDebit ? "−" : "+";
  return `${sign}${magnitude}¢`;
}

function formatTxnDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function humanizeType(type: string): string {
  return type.replace(/[_-]+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Pure presentational view for the Usage & Billing panel (#1422). Kept separate
 * from the fetching container so it can be rendered with an injected summary in
 * tests (`renderToStaticMarkup`). Renders four visually distinct sections: plan,
 * credits (monetary balance), usage limits (rate quotas), and usage history.
 */
export function UsageBillingView({
  summary,
  onRequestCredits,
  requesting = false,
  now,
}: {
  summary: UsageSummary;
  onRequestCredits?: () => void;
  requesting?: boolean;
  now?: number;
}) {
  const { credits, limits, plan } = summary;
  const transactions = credits.recentTransactions ?? [];

  return (
    <div className="usage-billing">
      {/* Plan --------------------------------------------------------------- */}
      <section className="usage-billing-block" aria-labelledby="usage-plan-heading">
        <div className="usage-billing-block-head">
          <h3 id="usage-plan-heading" className="settings-section-title">
            Plan
          </h3>
        </div>
        <div className="usage-plan-row">
          <span className="usage-plan-chip" data-tier={plan.tier}>
            {plan.tier === "free" ? "Free" : plan.tier}
          </span>
          <span className="usage-muted-note">Artist Pro — coming soon</span>
        </div>
      </section>

      {/* Credits (money) ---------------------------------------------------- */}
      <section className="usage-billing-block" aria-labelledby="usage-credits-heading">
        <div className="usage-billing-block-head">
          <h3 id="usage-credits-heading" className="settings-section-title">
            Credits
          </h3>
          <p className="settings-copy">
            A pre-funded balance spent down per AI action. Run out and you can request a top-up
            from an operator.
          </p>
        </div>
        <CreditBalanceMeter
          variant="panel"
          balance={credits}
          onRequestCredits={onRequestCredits}
          requesting={requesting}
        />
        <div className="usage-autoreload" aria-disabled="true">
          <div>
            <strong>Auto-reload</strong>
            <small>Automatically top up when your balance runs low.</small>
          </div>
          <button type="button" className="ui-btn ui-btn-ghost" disabled>
            Coming soon
          </button>
        </div>
      </section>

      {/* Usage limits (rate quotas) ---------------------------------------- */}
      <section className="usage-billing-block" aria-labelledby="usage-limits-heading">
        <div className="usage-billing-block-head">
          <h3 id="usage-limits-heading" className="settings-section-title">
            Usage limits
          </h3>
          <p className="settings-copy">
            Fair-use rate quotas that reset over time — separate from your credit balance. Hitting
            a limit means waiting for the reset, not topping up.
          </p>
        </div>
        {limits.length ? (
          <ul className="usage-limit-list">
            {limits.map((limit) => {
              const pct =
                limit.limit > 0
                  ? Math.max(0, Math.min(100, (limit.remaining / limit.limit) * 100))
                  : 0;
              const depleted = limit.remaining <= 0;
              return (
                <li key={limit.kind} className="usage-limit-row">
                  <div className="usage-limit-head">
                    <span className="usage-limit-label">{limit.label}</span>
                    <span
                      className="usage-limit-count"
                      data-depleted={depleted ? "true" : undefined}
                    >
                      {limit.remaining} / {limit.limit}
                    </span>
                  </div>
                  <div
                    className="usage-limit-bar"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={limit.limit}
                    aria-valuenow={limit.remaining}
                    aria-label={`${limit.label} remaining`}
                  >
                    <div className="usage-limit-bar-fill" style={{ width: `${pct}%` }} />
                  </div>
                  <span className="usage-limit-reset">{formatResetIn(limit.resetsAt, now)}</span>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="usage-empty">No usage limits apply to your account.</div>
        )}
      </section>

      {/* Usage history ------------------------------------------------------ */}
      <section className="usage-billing-block" aria-labelledby="usage-history-heading">
        <div className="usage-billing-block-head">
          <h3 id="usage-history-heading" className="settings-section-title">
            Usage history
          </h3>
          <p className="settings-copy">Your most recent credit activity.</p>
        </div>
        {transactions.length ? (
          <div className="usage-history-scroll">
            <table className="usage-history-table">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Type</th>
                  <th scope="col">Reason</th>
                  <th scope="col" className="usage-num">
                    Amount
                  </th>
                  <th scope="col" className="usage-num">
                    Balance
                  </th>
                </tr>
              </thead>
              <tbody>
                {transactions.map((txn) => (
                  <tr key={txn.id}>
                    <td>{formatTxnDate(txn.createdAt)}</td>
                    <td>{humanizeType(txn.type)}</td>
                    <td>{txn.reason || "—"}</td>
                    <td className="usage-num">{formatLedgerAmount(txn.type, txn.amountCents)}</td>
                    <td className="usage-num">{txn.balanceAfterCents}¢</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="usage-empty">No usage yet.</div>
        )}
      </section>
    </div>
  );
}

/**
 * Settings → Usage & Billing panel (#1422). Read-only: reads the unified
 * `GET /usage/summary` snapshot and renders plan tier, credit balance, per-kind
 * usage limits, and a usage-history table. The only write is the operator
 * credit-request affordance (reused from #1418).
 */
export default function UsageBillingPanel({ token, addToast }: Props) {
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [creditRequestState, setCreditRequestState] = useState<CreditRequestState>("idle");

  const load = async () => {
    if (!token) return;
    setLoading(true);
    setError(false);
    try {
      setSummary(await getUsageSummary(token));
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token changes are the reload boundary.
  }, [token]);

  const handleRequestCredits = async () => {
    if (!token || creditRequestState !== "idle") return;
    setCreditRequestState("sending");
    try {
      await requestGenerationCredits(token);
      setCreditRequestState("sent");
      addToast({
        type: "success",
        title: "Operator notified",
        message: "You’ll get generation credits soon.",
      });
    } catch {
      setCreditRequestState("idle");
      addToast({
        type: "error",
        title: "Request failed",
        message: "Could not send the request. Please try again.",
      });
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <h3 className="settings-section-title">Usage &amp; Billing</h3>
          <p className="home-subtitle">
            Your plan, generation credits, usage limits, and recent activity.
          </p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading || !token}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {loading && !summary ? (
        <div className="usage-empty" role="status">
          Loading usage &amp; billing…
        </div>
      ) : error && !summary ? (
        <div className="usage-error" role="alert">
          <p>Could not load your usage &amp; billing summary.</p>
          <Button variant="ghost" onClick={load} disabled={!token}>
            Retry
          </Button>
        </div>
      ) : summary ? (
        <UsageBillingView
          summary={summary}
          onRequestCredits={handleRequestCredits}
          requesting={creditRequestState === "sending"}
        />
      ) : null}
    </div>
  );
}
