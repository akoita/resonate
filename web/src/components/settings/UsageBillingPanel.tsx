"use client";

import { useEffect, useState } from "react";
import { getUsageSummary, requestGenerationCredits, type UsageSummary } from "../../lib/api";
import { CreditBalanceMeter } from "../credits/CreditBalanceMeter";
import { UsageLimitMeter } from "../credits/UsageLimitMeter";
import { formatCents } from "../../lib/usage";
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
 * tests (`renderToStaticMarkup`). Renders visually distinct sections: plan,
 * credits (monetary balance), usage limits (rate quotas), spend by action, and
 * usage history. There is no purchase affordance: nothing is sold yet.
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
  const { credits, limits, breakdown, plan } = summary;
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
        <div className="usage-grant-info">
          <strong>How credits are granted today</strong>
          <ul>
            <li>
              New accounts can start with a one-time free allowance, when the operator has turned
              it on.
            </li>
            <li>
              An operator can grant more. Use <em>Request credits</em> when you run low and
              you&rsquo;ll be notified once they&rsquo;re added.
            </li>
            <li>A generation that fails is refunded automatically.</li>
            <li>Buying credits and automatic top-ups are not available yet.</li>
          </ul>
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
            {limits.map((limit) => (
              <li key={limit.kind}>
                <UsageLimitMeter limit={limit} now={now} />
              </li>
            ))}
          </ul>
        ) : (
          <div className="usage-empty">No usage limits apply to your account.</div>
        )}
      </section>

      {/* Spend by action (credits, per metered kind) ----------------------- */}
      <section className="usage-billing-block" aria-labelledby="usage-breakdown-heading">
        <div className="usage-billing-block-head">
          <h3 id="usage-breakdown-heading" className="settings-section-title">
            Spend by action
          </h3>
          <p className="settings-copy">
            What each kind of AI action cost you in credits over the last {breakdown.periodDays}{" "}
            days, net of refunds for failed runs. Prices are per 30 seconds of audio.
          </p>
        </div>
        {breakdown.items.some((item) => item.charges > 0) ? (
          <div className="usage-history-scroll">
            <table className="usage-history-table">
              <thead>
                <tr>
                  <th scope="col">Action</th>
                  <th scope="col" className="usage-num">
                    Price
                  </th>
                  <th scope="col" className="usage-num">
                    Runs
                  </th>
                  <th scope="col" className="usage-num">
                    Spent
                  </th>
                  <th scope="col" className="usage-num">
                    Refunded
                  </th>
                  <th scope="col" className="usage-num">
                    Net
                  </th>
                </tr>
              </thead>
              <tbody>
                {breakdown.items.map((item) => (
                  <tr key={`${item.kind}:${item.lineId}`}>
                    <td>{item.label}</td>
                    <td className="usage-num">
                      {formatCents(item.unitCostCents)} / {item.unitSeconds}s
                    </td>
                    <td className="usage-num">{item.charges}</td>
                    <td className="usage-num">{formatCents(item.spentCents)}</td>
                    <td className="usage-num">{formatCents(item.refundedCents)}</td>
                    <td className="usage-num">{formatCents(item.netCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="usage-empty">
            No credits spent in the last {breakdown.periodDays} days.{" "}
            {breakdown.items
              .map((item) => `${item.label}: ${formatCents(item.unitCostCents)} per ${item.unitSeconds}s`)
              .join(" · ")}
            .
          </div>
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
 * The Usage & Billing panel body for each fetch state (#1422): loading, error
 * (with a Retry action), and the loaded view. Pure, so the states are testable
 * with `renderToStaticMarkup`; the container owns the fetching.
 */
export function UsageBillingBody({
  summary,
  loading,
  error,
  onRetry,
  retryDisabled = false,
  onRequestCredits,
  requesting = false,
  now,
}: {
  summary: UsageSummary | null;
  loading: boolean;
  error: boolean;
  onRetry?: () => void;
  retryDisabled?: boolean;
  onRequestCredits?: () => void;
  requesting?: boolean;
  now?: number;
}) {
  if (summary) {
    return (
      <UsageBillingView
        summary={summary}
        onRequestCredits={onRequestCredits}
        requesting={requesting}
        now={now}
      />
    );
  }
  if (loading) {
    return (
      <div className="usage-empty" role="status">
        Loading usage &amp; billing…
      </div>
    );
  }
  if (error) {
    return (
      <div className="usage-error" role="alert">
        <p>Could not load your usage &amp; billing summary.</p>
        <Button variant="ghost" onClick={onRetry} disabled={retryDisabled}>
          Retry
        </Button>
      </div>
    );
  }
  return null;
}

/**
 * Settings → Usage & Billing panel (#1422). Read-only: reads the unified
 * `GET /usage/summary` snapshot and renders plan tier, credit balance, per-kind
 * usage limits, spend by action, and a usage-history table. The only write is the operator
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
            Your plan, generation credits, usage limits, spend by action, and recent activity.
          </p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading || !token}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <UsageBillingBody
        summary={summary}
        loading={loading}
        error={error}
        onRetry={load}
        retryDisabled={!token}
        onRequestCredits={handleRequestCredits}
        requesting={creditRequestState === "sending"}
      />
    </div>
  );
}
