"use client";

import { useState, useEffect } from "react";
import { useAuth } from "../auth/AuthProvider";
import { formatEth, formatOptionalDate } from "../../lib/stakeConstants";
import { useBreakpoint } from "../../hooks/useBreakpoint";

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
  const { isPhone, isTablet } = useBreakpoint();

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
          <div className="kpi-row" style={{ marginBottom: "24px" }}>
            {kpis.map(kpi => (
              <div key={kpi.label} className={`premium-kpi-card ${kpi.label === "Slashed" ? "agent-context" : "human-context"}`}>
                <div className="kpi-header">
                  <span className="kpi-label">{kpi.label}</span>
                  <div className="kpi-icon-glow">{kpi.icon}</div>
                </div>
                <div className="kpi-value-mono">{kpi.value}</div>
                <div className="kpi-subtitle-trend">
                  <span className={kpi.alert ? "kpi-trend-up" : "kpi-trend-neutral"}>{kpi.sub}</span>
                </div>
              </div>
            ))}
          </div>

          {/* Stakes table */}
          <div className="premium-table-wrapper">
            <h2>Stake History</h2>
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Release</th>
                  <th>Amount</th>
                  <th>Deposited</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {data.stakes.map((s, i) => {
                  const status = s.slashedAt ? "slashed" : s.refundedAt ? "refunded" : s.active ? "active" : "inactive";
                  const statusLabels: Record<string, string> = {
                    active: "Active ✓",
                    slashed: "Slashed ✕",
                    refunded: "Refunded",
                    inactive: "Inactive",
                  };
                  return (
                    <tr key={i}>
                      <td>
                        <span style={{ fontWeight: 600 }}>
                          {s.releaseTitle || "Unknown Release"}
                        </span>
                      </td>
                      <td className="premium-table-cell-mono">{formatEth(s.amount)}</td>
                      <td className="premium-table-cell-mono" style={{ opacity: 0.7 }}>
                        {formatOptionalDate(s.depositedAt)}
                      </td>
                      <td>
                        <span className={`status-capsule-badge ${status}`}>
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
