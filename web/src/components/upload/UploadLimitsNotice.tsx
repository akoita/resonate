"use client";

import type { UploadAllowance, UploadLimitKey } from "../../lib/api";

/**
 * #2659: what a new account may still upload, shown before an upload is
 * refused. Verified artists and accounts whose limits were lifted see nothing.
 */
const LABELS: Record<UploadLimitKey, string> = {
  releasesPerDay: "releases today",
  tracksPerDay: "tracks today",
  releasesTotal: "releases in total",
  tracksTotal: "tracks in total",
};

const ORDER: UploadLimitKey[] = ["releasesPerDay", "tracksPerDay", "releasesTotal", "tracksTotal"];

export function describeUploadAllowance(allowance: UploadAllowance | null, trackCount: number) {
  if (!allowance || !allowance.limited) return null;
  const rows = ORDER.flatMap((key) => {
    const limit = allowance.limits[key];
    if (limit === null || limit === undefined) return [];
    const remaining = allowance.remaining?.[key] ?? limit;
    return [{ key, limit, remaining, label: LABELS[key] }];
  });
  if (rows.length === 0) return null;
  const needed: Record<UploadLimitKey, number> = {
    releasesPerDay: 1,
    releasesTotal: 1,
    tracksPerDay: Math.max(1, trackCount),
    tracksTotal: Math.max(1, trackCount),
  };
  const blocking = rows.find((row) => row.remaining < needed[row.key]) ?? null;
  return { rows, blocking };
}

export default function UploadLimitsNotice({
  allowance,
  trackCount,
}: {
  allowance: UploadAllowance | null;
  trackCount: number;
}) {
  const described = describeUploadAllowance(allowance, trackCount);
  if (!described) return null;
  const { rows, blocking } = described;
  return (
    <section
      aria-labelledby="upload-limits-heading"
      data-blocking={blocking ? "true" : undefined}
      style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${blocking ? "rgba(245, 158, 11, 0.4)" : "rgba(255,255,255,0.06)"}`,
        borderRadius: "12px",
        padding: "16px",
        marginTop: "16px",
        fontSize: "13px",
        lineHeight: 1.5,
      }}
    >
      <h3 id="upload-limits-heading" style={{ margin: "0 0 8px", fontSize: "14px", fontWeight: 600 }}>
        Upload limits for new accounts
      </h3>
      <p style={{ margin: "0 0 8px", opacity: 0.7 }}>
        Until your account is verified, you can publish a limited number of releases and tracks. Ask us if you need
        more.
      </p>
      <ul style={{ margin: 0, paddingLeft: "18px" }}>
        {rows.map((row) => (
          <li key={row.key}>
            <strong>{row.remaining}</strong> of {row.limit} {row.label} left
          </li>
        ))}
      </ul>
      {blocking && (
        <p role="alert" style={{ margin: "10px 0 0", color: "#f59e0b" }}>
          This upload would go over your limit of {blocking.limit} {blocking.label}.
          {blocking.key.endsWith("PerDay") ? " Try again tomorrow, or upload fewer tracks." : " Ask us to lift the limit."}
        </p>
      )}
    </section>
  );
}
