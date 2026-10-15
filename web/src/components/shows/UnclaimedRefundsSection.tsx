"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { formatPaymentAmountWithSymbol } from "../../lib/payments";
import { getUnclaimedShowRefunds, type UnclaimedRefundCampaign } from "../../lib/shows";

const REMINDER_LABELS = ["Sent on opening", "Sent at day 7", "Sent at day 30 (final)"];

export function reminderLabel(step: number | null) {
  return step === null ? "None sent yet" : (REMINDER_LABELS[step] ?? `Step ${step + 1} sent`);
}

function ageLabel(days: number) {
  return days === 0 ? "today" : days === 1 ? "1 day" : `${days} days`;
}

/** Presentation only: one row per campaign with refunds still unclaimed. */
export function UnclaimedRefundsList({ campaigns }: { campaigns: UnclaimedRefundCampaign[] }) {
  if (campaigns.length === 0) {
    return <p>No unclaimed refunds. Every backer of a refund-open campaign has claimed.</p>;
  }
  return (
    <table className="show-detail__operator-table" style={{ width: "100%", borderCollapse: "collapse" }}>
      <thead>
        <tr>
          <th align="left">Campaign</th>
          <th align="right">Backers</th>
          <th align="right">Unclaimed (up to)</th>
          <th align="right">Refunds open for</th>
          <th align="left">Reminders</th>
        </tr>
      </thead>
      <tbody>
        {campaigns.map((campaign) => (
          <tr key={campaign.campaignId}>
            <td>
              <Link href={`/shows/${campaign.campaignId}`}>{campaign.title}</Link>
              <div style={{ opacity: 0.7 }}>
                {campaign.artistDisplayName} · {campaign.city}
              </div>
            </td>
            <td align="right">{campaign.backerCount}</td>
            <td align="right">
              {formatPaymentAmountWithSymbol(
                campaign.totalUnclaimedUnits,
                campaign.asset.decimals,
                campaign.asset.symbol,
              )}
            </td>
            <td align="right">{ageLabel(campaign.oldestAgeDays)}</td>
            <td>{reminderLabel(campaign.lastReminderStep)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; campaigns: UnclaimedRefundCampaign[] };

/**
 * #2149 operator view of unclaimed refunds. With `campaignId` it covers one
 * campaign (the operator panel); without, every refund-open campaign (the admin
 * page). Figures come from the database, so they can trail a claim the indexer
 * has not seen yet.
 */
export function UnclaimedRefundsSection({ campaignId }: { campaignId?: string }) {
  const { token } = useAuth();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    getUnclaimedShowRefunds({ token, campaignId })
      .then((campaigns) => !cancelled && setState({ status: "ready", campaigns }))
      .catch(() => !cancelled && setState({ status: "error" }));
    return () => {
      cancelled = true;
    };
  }, [token, campaignId]);

  return (
    <section aria-label="Unclaimed refunds">
      <h3>Unclaimed refunds</h3>
      {state.status === "loading" ? <p>Loading unclaimed refunds...</p> : null}
      {state.status === "error" ? <p role="alert">Unclaimed refunds could not be loaded.</p> : null}
      {state.status === "ready" ? <UnclaimedRefundsList campaigns={state.campaigns} /> : null}
      <p style={{ opacity: 0.7 }}>
        From recorded state, so a claim made moments ago may not show yet. Backers are reminded in the app when refunds
        open, then after 7 and 30 days.
      </p>
    </section>
  );
}
