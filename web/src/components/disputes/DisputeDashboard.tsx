"use client";

import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useDisputeNotifications } from "../../hooks/useDisputeNotifications";

interface Dispute {
  id: string;
  tokenId: string;
  reporterAddr: string;
  creatorAddr: string;
  status: string;
  outcome: string | null;
  evidenceURI: string;
  counterStake: string;
  resolvedAt: string | null;
  createdAt: string;
  evidences: DisputeEvidence[];
}

interface DisputeEvidence {
  id: string;
  submitter: string;
  party: string;
  evidenceURI: string;
  description: string | null;
  createdAt: string;
}

type Tab = "reporter" | "creator";

export default function DisputeDashboard() {
  const { address } = useAuth();
  const { disputeUpdate } = useDisputeNotifications(address ?? undefined);
  const [tab, setTab] = useState<Tab>("reporter");
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);
  const [reputation, setReputation] = useState({
    score: 0,
    successfulFlags: 0,
    rejectedFlags: 0,
  });

  const fetchDisputes = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const endpoint =
        tab === "reporter"
          ? `/api/metadata/disputes/reporter/${address}`
          : `/api/metadata/disputes/creator/${address}`;
      const res = await fetch(endpoint);
      if (res.ok) {
        setDisputes(await res.json());
      }
    } finally {
      setLoading(false);
    }
  }, [address, tab]);

  const fetchReputation = useCallback(async () => {
    if (!address) return;
    try {
      const res = await fetch(`/api/metadata/curators/${address}`);
      if (res.ok) {
        setReputation(await res.json());
      }
    } catch {
      // silent
    }
  }, [address]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  useEffect(() => {
    fetchReputation();
  }, [fetchReputation]);

  // Real-time: auto-refresh when dispute status changes via WebSocket
  useEffect(() => {
    if (disputeUpdate) {
      fetchDisputes();
    }
  }, [disputeUpdate, fetchDisputes]);

  const statusColor = (status: string) => {
    switch (status.toLowerCase()) {
      case "filed":
        return "#f59e0b";
      case "evidence":
        return "#3b82f6";
      case "review":
        return "#8b5cf6";
      case "resolved":
        return "#10b981";
      case "appealed":
        return "#f97316";
      default:
        return "#6b7280";
    }
  };

  const outcomeColor = (outcome: string | null) => {
    switch (outcome) {
      case "upheld":
        return "#10b981";
      case "rejected":
        return "#ef4444";
      case "inconclusive":
        return "#f59e0b";
      default:
        return "#6b7280";
    }
  };

  if (!address) {
    return (
      <div style={containerStyle}>
        <p style={{ opacity: 0.5, textAlign: "center", padding: "40px 0" }}>
          Connect your wallet to view disputes
        </p>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>
          ⚖️ Dispute Center
        </h1>
        {/* Reputation badge */}
        <div style={repBadgeStyle}>
          <span style={{ fontSize: "12px", opacity: 0.6 }}>Reputation</span>
          <span
            style={{
              fontSize: "20px",
              fontWeight: 700,
              color: reputation.score > 0 ? "#10b981" : reputation.score < 0 ? "#ef4444" : "#6b7280",
            }}
          >
            {reputation.score}
          </span>
          <div style={{ fontSize: "11px", opacity: 0.5, marginTop: "2px" }}>
            ✅ {reputation.successfulFlags} · ❌ {reputation.rejectedFlags}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={tabBarStyle}>
        <button
          onClick={() => setTab("reporter")}
          style={{
            ...tabStyle,
            ...(tab === "reporter" ? activeTabStyle : {}),
          }}
        >
          📣 My Reports
        </button>
        <button
          onClick={() => setTab("creator")}
          style={{
            ...tabStyle,
            ...(tab === "creator" ? activeTabStyle : {}),
          }}
        >
          🛡️ Against My Content
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div style={emptyStyle}>Loading disputes...</div>
      ) : disputes.length === 0 ? (
        <div style={emptyStyle}>
          {tab === "reporter"
            ? "You haven't filed any disputes yet"
            : "No disputes filed against your content"}
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {disputes.map((d) => (
            <div key={d.id} style={cardStyle}>
              <div style={cardHeaderStyle}>
                <div>
                  <span style={{ fontWeight: 600, fontSize: "14px" }}>
                    Token #{d.tokenId}
                  </span>
                  <span
                    style={{
                      ...statusBadgeStyle,
                      borderColor: statusColor(d.status),
                      color: statusColor(d.status),
                    }}
                  >
                    {d.status.toUpperCase()}
                  </span>
                  {d.outcome && (
                    <span
                      style={{
                        ...statusBadgeStyle,
                        borderColor: outcomeColor(d.outcome),
                        color: outcomeColor(d.outcome),
                        background: `${outcomeColor(d.outcome)}10`,
                      }}
                    >
                      {d.outcome.toUpperCase()}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: "12px", opacity: 0.4 }}>
                  {new Date(d.createdAt).toLocaleDateString()}
                </span>
              </div>

              {/* Evidence */}
              <div style={{ marginTop: "8px" }}>
                <a
                  href={d.evidenceURI}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={linkStyle}
                >
                  📎 Initial Evidence
                </a>
                {d.evidences.length > 0 && (
                  <span style={{ fontSize: "12px", opacity: 0.5, marginLeft: "8px" }}>
                    +{d.evidences.length} additional evidence(s)
                  </span>
                )}
              </div>

              {/* Parties */}
              <div style={partiesStyle}>
                <div>
                  <span style={partyLabelStyle}>Reporter</span>
                  <span style={addressStyle}>
                    {d.reporterAddr.slice(0, 6)}...{d.reporterAddr.slice(-4)}
                  </span>
                </div>
                <div>
                  <span style={partyLabelStyle}>Creator</span>
                  <span style={addressStyle}>
                    {d.creatorAddr.slice(0, 6)}...{d.creatorAddr.slice(-4)}
                  </span>
                </div>
              </div>

              {/* Appeal button for resolved disputes */}
              {d.status.toLowerCase() === "resolved" && d.outcome && d.outcome !== "inconclusive" && (
                <div style={{ marginTop: "10px" }}>
                  <button
                    style={{
                      background: "none",
                      border: "1px solid #f97316",
                      borderRadius: "8px",
                      padding: "6px 14px",
                      color: "#f97316",
                      fontSize: "12px",
                      fontWeight: 600,
                      cursor: "pointer",
                      transition: "all 0.2s",
                    }}
                    onClick={() => window.alert("Appeal requires submitting a 2x counter-stake via the smart contract. Use the Contract UI or CLI.")}
                  >
                    ⚠️ Appeal Decision
                  </button>
                  <span style={{ fontSize: "11px", opacity: 0.4, marginLeft: "8px" }}>Requires 2× stake</span>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---- Styles ----

const containerStyle: React.CSSProperties = {
  maxWidth: "800px",
  margin: "0 auto",
  padding: "20px",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  marginBottom: "24px",
};

const repBadgeStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "12px",
  padding: "10px 16px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  minWidth: "100px",
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  gap: "4px",
  marginBottom: "20px",
  background: "rgba(255,255,255,0.03)",
  borderRadius: "10px",
  padding: "3px",
};

const tabStyle: React.CSSProperties = {
  flex: 1,
  background: "none",
  border: "none",
  borderRadius: "8px",
  padding: "10px",
  color: "rgba(255,255,255,0.5)",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
  transition: "all 0.2s",
};

const activeTabStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "60px 20px",
  opacity: 0.4,
  fontSize: "14px",
};

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  padding: "16px",
};

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
};

const statusBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  border: "1px solid",
  borderRadius: "6px",
  padding: "2px 8px",
  fontSize: "10px",
  fontWeight: 600,
  marginLeft: "8px",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const linkStyle: React.CSSProperties = {
  color: "#60a5fa",
  fontSize: "13px",
  textDecoration: "none",
};

const partiesStyle: React.CSSProperties = {
  display: "flex",
  gap: "24px",
  marginTop: "10px",
  fontSize: "12px",
};

const partyLabelStyle: React.CSSProperties = {
  opacity: 0.4,
  marginRight: "6px",
};

const addressStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "11px",
  opacity: 0.7,
};
