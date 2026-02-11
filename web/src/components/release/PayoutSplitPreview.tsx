"use client";

import React from "react";

interface PayoutSplitPreviewProps {
  priceUsd: number;
}

const SPLITS = [
  { label: "Artist", pct: 70, color: "#8b5cf6" },
  { label: "Mixer / Remixer", pct: 20, color: "#3b82f6" },
  { label: "Platform", pct: 10, color: "#6b7280" },
];

export function PayoutSplitPreview({ priceUsd }: PayoutSplitPreviewProps) {
  // Build conic-gradient segments using reduce to avoid mutable reassignment
  const { segments } = SPLITS.reduce<{ segments: string[]; cumulative: number }>(
    (acc, s) => {
      const start = acc.cumulative;
      const end = start + s.pct;
      acc.segments.push(`${s.color} ${start}% ${end}%`);
      acc.cumulative = end;
      return acc;
    },
    { segments: [], cumulative: 0 },
  );

  const gradient = `conic-gradient(${segments.join(", ")})`;

  return (
    <div className="payout-split-container">
      <div className="split-donut" style={{ background: gradient }} />
      <div className="split-legend">
        {SPLITS.map((s) => (
          <div key={s.label} className="split-legend-row">
            <span className="split-color-dot" style={{ background: s.color }} />
            <span className="split-legend-label">{s.label}</span>
            <span className="split-legend-value">{s.pct}%</span>
            {priceUsd > 0 && (
              <span className="split-legend-amount">
                ${((priceUsd * s.pct) / 100).toFixed(4)}
              </span>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
