"use client";

import React, { useEffect, useState } from "react";
import {
  STEM_SALE_TIERS,
  artistNetUsd,
  fetchStemSaleSplit,
  formatSplitPercent,
  formatSplitUsd,
  type StemSaleSplit,
  type StemSaleTier,
} from "../../lib/stemSaleSplit";

export type PayoutSplitPrices = Record<StemSaleTier, number>;

const TIER_LABELS: Record<StemSaleTier, string> = {
  personal: "Personal (per play)",
  remix: "Remix licence",
  commercial: "Commercial licence",
};

export type PayoutSplitState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; split: StemSaleSplit };

/** Pure view: what the artist keeps per licence tier, from the server's split. */
export function PayoutSplitView({
  prices,
  state,
}: {
  prices: PayoutSplitPrices;
  state: PayoutSplitState;
}) {
  return (
    <section className="payout-split-container" aria-label="What you keep from each sale">
      <h4 className="payout-split-title">What you keep from each sale</h4>
      {state.status === "loading" && (
        <p className="payout-split-note" role="status">Loading the current split…</p>
      )}
      {state.status === "error" && (
        <p className="payout-split-note" role="alert">
          We couldn&apos;t load the current split, so no numbers are shown. Your prices are not affected.
        </p>
      )}
      {state.status === "ready" && (
        <>
          <ul className="payout-split-tiers">
            {STEM_SALE_TIERS.map((tier) => {
              const { artistBps, platformFeeBps } = state.split.tiers[tier];
              const net = artistNetUsd(prices[tier], artistBps);
              return (
                <li key={tier} className="payout-split-tier">
                  <div className="payout-split-tier-head">
                    <span className="split-legend-label">{TIER_LABELS[tier]}</span>
                    <span className="split-legend-value">You keep {formatSplitPercent(artistBps)}</span>
                  </div>
                  <div className="payout-split-bar" aria-hidden="true">
                    <span className="payout-split-bar-artist" style={{ width: `${artistBps / 100}%` }} />
                  </div>
                  <div className="split-legend-amount">
                    {net === null
                      ? `Platform fee ${formatSplitPercent(platformFeeBps)}`
                      : `${formatSplitUsd(net)} of ${formatSplitUsd(prices[tier])} · platform fee ${formatSplitPercent(platformFeeBps)}`}
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="payout-split-note">
            You keep at least {formatSplitPercent(state.split.minArtistBps)} of every sale of your own stem.
          </p>
        </>
      )}
    </section>
  );
}

export function PayoutSplitPreview({ prices }: { prices: PayoutSplitPrices }) {
  const [state, setState] = useState<PayoutSplitState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();
    fetchStemSaleSplit(controller.signal)
      .then((split) => setState({ status: "ready", split }))
      .catch(() => {
        if (!controller.signal.aborted) setState({ status: "error" });
      });
    return () => controller.abort();
  }, []);

  return <PayoutSplitView prices={prices} state={state} />;
}
