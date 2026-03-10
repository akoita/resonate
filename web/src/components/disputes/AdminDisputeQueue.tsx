"use client";

import { useState, useEffect, useCallback } from "react";

interface Dispute {
  id: string;
  tokenId: string;
  reporterAddr: string;
  creatorAddr: string;
  status: string;
  outcome: string | null;
  evidenceURI: string;
  counterStake: string;
  createdAt: string;
  evidences: { id: string; submitter: string; party: string; evidenceURI: string; description: string | null }[];
}

export default function AdminDisputeQueue() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/metadata/disputes/pending?limit=50");
      if (res.ok) setDisputes(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const markUnderReview = async (id: string) => {
    setActionLoading(id);
    try {
      await fetch(`/api/metadata/disputes/${id}/review`, { method: "PATCH" });
      await fetchPending();
    } finally {
      setActionLoading(null);
    }
  };

  const resolve = async (id: string, outcome: string) => {
    setActionLoading(id);
    try {
      await fetch(`/api/metadata/disputes/${id}/resolve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ outcome }),
      });
      await fetchPending();
    } finally {
      setActionLoading(null);
    }
  };

  const statusColor = (status: string) => {
    const colors: Record<string, string> = {
      filed: "#f59e0b", FILED: "#f59e0b",
      evidence: "#3b82f6", EVIDENCE: "#3b82f6",
      review: "#8b5cf6",
      APPEALED: "#f97316", appealed: "#f97316",
    };
    return colors[status] || "#6b7280";
  };

  if (loading) {
    return <div style={{ textAlign: "center", padding: "60px", opacity: 0.4 }}>Loading dispute queue...</div>;
  }

  return (
    <div style={{ maxWidth: "900px", margin: "0 auto", padding: "20px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
        <h1 style={{ margin: 0, fontSize: "24px", fontWeight: 700 }}>🛠️ Admin Dispute Queue</h1>
        <span style={{ fontSize: "13px", opacity: 0.5 }}>{disputes.length} pending</span>
      </div>

      {disputes.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px", opacity: 0.3, fontSize: "14px" }}>
          No pending disputes — all clear ✨
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
          {disputes.map((d) => (
            <div key={d.id} style={cardStyle}>
              {/* Header */}
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <span style={{ fontWeight: 600, fontSize: "14px" }}>Token #{d.tokenId}</span>
                  <span style={{ ...badgeStyle, borderColor: statusColor(d.status), color: statusColor(d.status) }}>
                    {d.status.toUpperCase()}
                  </span>
                </div>
                <span style={{ fontSize: "12px", opacity: 0.4 }}>{new Date(d.createdAt).toLocaleDateString()}</span>
              </div>

              {/* Evidence */}
              <div style={{ marginTop: "10px", fontSize: "13px" }}>
                <a href={d.evidenceURI} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
                  📎 Initial Evidence
                </a>
                {d.evidences.length > 0 && (
                  <div style={{ marginTop: "6px" }}>
                    {d.evidences.map((e) => (
                      <div key={e.id} style={{ fontSize: "12px", opacity: 0.6, marginTop: "3px" }}>
                        {e.party === "reporter" ? "📣" : "🛡️"}{" "}
                        <a href={e.evidenceURI} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
                          {e.description || "Evidence"}
                        </a>
                        <span style={{ opacity: 0.4, marginLeft: "6px" }}>
                          by {e.submitter.slice(0, 6)}...{e.submitter.slice(-4)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Parties */}
              <div style={{ display: "flex", gap: "24px", marginTop: "10px", fontSize: "12px" }}>
                <div>
                  <span style={{ opacity: 0.4, marginRight: "4px" }}>Reporter</span>
                  <span style={{ fontFamily: "monospace", fontSize: "11px", opacity: 0.7 }}>
                    {d.reporterAddr.slice(0, 6)}...{d.reporterAddr.slice(-4)}
                  </span>
                </div>
                <div>
                  <span style={{ opacity: 0.4, marginRight: "4px" }}>Creator</span>
                  <span style={{ fontFamily: "monospace", fontSize: "11px", opacity: 0.7 }}>
                    {d.creatorAddr.slice(0, 6)}...{d.creatorAddr.slice(-4)}
                  </span>
                </div>
                <div>
                  <span style={{ opacity: 0.4, marginRight: "4px" }}>Stake</span>
                  <span style={{ fontFamily: "monospace", fontSize: "11px" }}>{d.counterStake} wei</span>
                </div>
              </div>

              {/* Actions */}
              <div style={{ display: "flex", gap: "8px", marginTop: "14px" }}>
                {d.status !== "review" && (
                  <button
                    onClick={() => markUnderReview(d.id)}
                    disabled={actionLoading === d.id}
                    style={{ ...actionBtnStyle, borderColor: "#8b5cf6", color: "#8b5cf6" }}
                  >
                    {actionLoading === d.id ? "..." : "📋 Mark Under Review"}
                  </button>
                )}
                <button
                  onClick={() => resolve(d.id, "upheld")}
                  disabled={actionLoading === d.id}
                  style={{ ...actionBtnStyle, borderColor: "#10b981", color: "#10b981" }}
                >
                  ✅ Upheld
                </button>
                <button
                  onClick={() => resolve(d.id, "rejected")}
                  disabled={actionLoading === d.id}
                  style={{ ...actionBtnStyle, borderColor: "#ef4444", color: "#ef4444" }}
                >
                  ❌ Rejected
                </button>
                <button
                  onClick={() => resolve(d.id, "inconclusive")}
                  disabled={actionLoading === d.id}
                  style={{ ...actionBtnStyle, borderColor: "#f59e0b", color: "#f59e0b" }}
                >
                  ⚠️ Inconclusive
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  padding: "16px",
};

const badgeStyle: React.CSSProperties = {
  display: "inline-block",
  border: "1px solid",
  borderRadius: "6px",
  padding: "2px 8px",
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const actionBtnStyle: React.CSSProperties = {
  background: "none",
  border: "1px solid",
  borderRadius: "8px",
  padding: "6px 12px",
  fontSize: "12px",
  fontWeight: 500,
  cursor: "pointer",
  transition: "all 0.2s",
};
