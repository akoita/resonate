"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { formatEth, formatOptionalDate } from "../../lib/stakeConstants";

interface StakeAnalytics {
  totalStaked: string;
  totalSlashed: string;
  counts: {
    total: number;
    active: number;
    slashed: number;
    refunded: number;
  };
  stakes: Array<{
    releaseTitle: string | null;
    amount: string;
    active: boolean;
    depositedAt: string;
    slashedAt: string | null;
    refundedAt: string | null;
  }>;
}

export default function StakingOverview() {
  const { address } = useAuth();
  const [data, setData] = useState<StakeAnalytics | null>(null);
  const [loading, setLoading] = useState(!!address);

  useEffect(() => {
    if (!address) return;

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    fetch(`/api/metadata/stakes/analytics/${address}`)
      .then(r => { if (!r.ok) throw new Error(); return r.json(); })
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [address]);

  if (!address) return null;

  const kpis = data ? [
    {
      icon: "🛡️",
      label: "Total Staked",
      value: formatEth(data.totalStaked),
      sub: `${data.counts.active} active stake${data.counts.active !== 1 ? "s" : ""}`,
    },
    {
      icon: "📦",
      label: "Protected Releases",
      value: data.counts.total.toString(),
      sub: "with Content Protection",
    },
    {
      icon: "⚠️",
      label: "Slashed",
      value: data.counts.slashed.toString(),
      sub: data.counts.slashed > 0 ? formatEth(data.totalSlashed) + " lost" : "No violations",
      alert: data.counts.slashed > 0,
    },
    {
      icon: "✅",
      label: "Refunded",
      value: data.counts.refunded.toString(),
      sub: "escrow released",
    },
  ] : [];

  return (
    <div>
      {/* Section header */}
      <div style={headerStyle}>
        <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>Content Protection</h2>
        <span style={{ fontSize: "12px", opacity: 0.5 }}>Staking & escrow overview</span>
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ padding: "32px", textAlign: "center", opacity: 0.5, fontSize: "13px" }}>
          Loading staking data…
        </div>
      )}

      {/* Empty state */}
      {!loading && (!data || data.counts.total === 0) && (
        <div style={emptyStyle}>
          <div style={{ fontSize: "28px", marginBottom: "8px" }}>🛡️</div>
          <p style={{ margin: 0, fontWeight: 500, fontSize: "14px" }}>No stakes yet</p>
          <p style={{ margin: "4px 0 0", fontSize: "12px", opacity: 0.5 }}>
            Stakes appear here when you publish releases with Content Protection.
          </p>
        </div>
      )}

      {/* KPI cards */}
      {data && data.counts.total > 0 && (
        <>
          <div style={kpiGridStyle}>
            {kpis.map(kpi => (
              <div key={kpi.label} style={kpiCardStyle}>
                <div style={{ fontSize: "20px", marginBottom: "8px" }}>{kpi.icon}</div>
                <div style={{ fontSize: "11px", opacity: 0.5, textTransform: "uppercase", letterSpacing: "0.5px" }}>
                  {kpi.label}
                </div>
                <div style={{
                  fontSize: "22px",
                  fontWeight: 700,
                  marginTop: "4px",
                  color: kpi.alert ? "#ef4444" : "#fff",
                }}>
                  {kpi.value}
                </div>
                <div style={{
                  fontSize: "11px",
                  opacity: 0.6,
                  marginTop: "4px",
                  color: kpi.alert ? "rgba(239, 68, 68, 0.7)" : undefined,
                }}>
                  {kpi.sub}
                </div>
              </div>
            ))}
          </div>

          {/* Stakes table */}
          <div style={tableContainerStyle}>
            <h3 style={{ margin: "0 0 12px", fontSize: "14px", fontWeight: 600 }}>Stake History</h3>
            <table style={tableStyle}>
              <thead>
                <tr>
                  <th style={thStyle}>Release</th>
                  <th style={thStyle}>Amount</th>
                  <th style={thStyle}>Deposited</th>
                  <th style={thStyle}>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.stakes.map((s, i) => {
                  const status = s.slashedAt ? "slashed" : s.refundedAt ? "refunded" : s.active ? "active" : "inactive";
                  const statusColors: Record<string, string> = {
                    active: "#10b981",
                    slashed: "#ef4444",
                    refunded: "#3b82f6",
                    inactive: "#6b7280",
                  };
                  const statusLabels: Record<string, string> = {
                    active: "Active ✓",
                    slashed: "Slashed ✕",
                    refunded: "Refunded",
                    inactive: "Inactive",
                  };
                  return (
                    <tr key={i} style={{ transition: "background 0.15s" }}>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 500, fontSize: "13px" }}>
                          {s.releaseTitle || "Unknown Release"}
                        </span>
                      </td>
                      <td style={tdStyle}>{formatEth(s.amount)}</td>
                      <td style={tdStyle}>
                        <span style={{ fontSize: "12px", opacity: 0.7 }}>
                          {formatOptionalDate(s.depositedAt)}
                        </span>
                      </td>
                      <td style={tdStyle}>
                        <span style={{ fontWeight: 600, fontSize: "12px", color: statusColors[status] }}>
                          {statusLabels[status]}
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

// ---- Styles ----

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "baseline",
  gap: "12px",
  marginBottom: "16px",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "40px 16px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "16px",
};

const kpiGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(4, 1fr)",
  gap: "12px",
  marginBottom: "20px",
};

const kpiCardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  padding: "16px",
};

const tableContainerStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "16px",
  padding: "20px",
};

const tableStyle: React.CSSProperties = {
  width: "100%",
  borderCollapse: "collapse",
  fontSize: "13px",
};

const thStyle: React.CSSProperties = {
  textAlign: "left",
  padding: "8px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  fontSize: "11px",
  fontWeight: 500,
  opacity: 0.5,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const tdStyle: React.CSSProperties = {
  padding: "10px 12px",
  borderBottom: "1px solid rgba(255,255,255,0.03)",
};
