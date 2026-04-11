"use client";

import { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { formatEth } from "../../lib/stakeConstants";

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
  evidences: Array<{
    id: string;
    submitter: string;
    party: string;
    evidenceURI: string;
    sourceUrl?: string | null;
    description: string | null;
    title?: string | null;
    kind?: string | null;
    strength?: string | null;
    verificationStatus?: string | null;
  }>;
}

/* ── Inline SVG Icons ──────────────────────────────────────────── */

function IconTool({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  );
}

function IconLink({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </svg>
  );
}

function IconCheckCircle({ size = 48 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  );
}

/* ── Priority helpers ──────────────────────────────────────────── */

function getAgeDays(createdAt: string): number {
  return (Date.now() - new Date(createdAt).getTime()) / 86400000;
}

function PriorityBadge({ createdAt }: { createdAt: string }) {
  const days = getAgeDays(createdAt);
  if (days > 7) {
    return (
      <span style={{ ...priorityBadgeBase, background: "rgba(239,68,68,0.1)", color: "#ef4444", borderColor: "rgba(239,68,68,0.2)" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: "#ef4444", animation: "priority-pulse 2s infinite" }} />
        Urgent
      </span>
    );
  }
  if (days > 3) {
    return (
      <span style={{ ...priorityBadgeBase, background: "rgba(245,158,11,0.1)", color: "#f59e0b", borderColor: "rgba(245,158,11,0.2)" }}>
        Aging
      </span>
    );
  }
  return null;
}

const statusColorMap: Record<string, string> = {
  filed: "#f59e0b",
  evidence: "#3b82f6",
  review: "#8b5cf6",
  appealed: "#f97316",
};

const outcomeConfig: Record<string, { label: string; variant: "danger" | "warning" | "default"; message: string }> = {
  upheld: { label: "Uphold Report", variant: "default", message: "This will uphold the reporter's claim and penalize the creator. This action cannot be easily reversed." },
  rejected: { label: "Reject Report", variant: "danger", message: "This will reject the report and penalize the reporter's reputation. This action cannot be easily reversed." },
  inconclusive: { label: "Mark Inconclusive", variant: "warning", message: "This will mark the dispute as inconclusive. Neither party will be penalized." },
};

export default function AdminDisputeQueue() {
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{ id: string; outcome: string } | null>(null);

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

  const handleConfirm = async () => {
    if (!confirmAction) return;
    await resolve(confirmAction.id, confirmAction.outcome);
    setConfirmAction(null);
  };

  const statusColor = (status: string) => statusColorMap[status.toLowerCase()] || "#6b7280";

  const toggleEvidence = (id: string) => {
    setExpandedEvidence((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div style={containerStyle}>
        <style>{`
          @keyframes admin-shimmer {
            0% { opacity: 0.5; }
            50% { opacity: 1; }
            100% { opacity: 0.5; }
          }
        `}</style>
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "60px" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ ...cardStyle, padding: "20px" }}>
              <div style={{ width: "140px", height: "14px", borderRadius: "6px", background: "rgba(255,255,255,0.06)", animation: "admin-shimmer 1.5s infinite", marginBottom: "12px" }} />
              <div style={{ width: "80%", height: "12px", borderRadius: "4px", background: "rgba(255,255,255,0.04)", animation: "admin-shimmer 1.5s infinite 0.2s" }} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      <style>{`
        @keyframes priority-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.4; }
        }
      `}</style>

      {/* Header */}
      <div style={headerStyle}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            <div style={{ color: "#7c5cff" }}><IconTool /></div>
            <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px" }}>
              Admin Dispute Queue
            </h1>
            <span style={pendingBadgeStyle}>
              {disputes.length} pending
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>
            Review and resolve pending content disputes
          </p>
        </div>
      </div>

      {/* Content */}
      {disputes.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 20px", gap: "16px" }}>
          <div style={{
            width: "72px",
            height: "72px",
            borderRadius: "18px",
            background: "rgba(16,185,129,0.06)",
            border: "1px solid rgba(16,185,129,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(16,185,129,0.4)",
          }}>
            <IconCheckCircle />
          </div>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>Queue cleared</div>
          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.3)" }}>No disputes require attention right now</div>
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {disputes.map((d) => {
            const isEvidenceExpanded = expandedEvidence.has(d.id);
            let stakeDisplay: string;
            try {
              stakeDisplay = formatEth(BigInt(d.counterStake));
            } catch {
              stakeDisplay = d.counterStake;
            }

            return (
              <div key={d.id} style={{ ...cardStyle, borderLeftColor: statusColor(d.status) }}>
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: "14px", fontFamily: "monospace" }}>
                      Token #{d.tokenId.length > 16 ? `${d.tokenId.slice(0, 8)}...${d.tokenId.slice(-4)}` : d.tokenId}
                    </span>
                    <span style={{ ...badgeStyle, borderColor: statusColor(d.status), color: statusColor(d.status) }}>
                      {d.status.toUpperCase()}
                    </span>
                    <PriorityBadge createdAt={d.createdAt} />
                  </div>
                  <span style={{ fontSize: "12px", opacity: 0.35, whiteSpace: "nowrap" }}>
                    {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Evidence */}
                <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px" }}>
                  {d.evidenceURI ? (
                    <a href={d.evidenceURI} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                      <IconLink />
                      <span>Initial Evidence</span>
                    </a>
                  ) : (
                    <span style={{ ...linkStyle, opacity: 0.45 }}>
                      <IconLink />
                      <span>Initial Evidence Pending</span>
                    </span>
                  )}
                  {d.evidences.length > 0 && (
                    <button onClick={() => toggleEvidence(d.id)} style={expandBtnStyle}>
                      {isEvidenceExpanded ? "collapse" : `+${d.evidences.length} more`}
                    </button>
                  )}
                </div>

                {isEvidenceExpanded && d.evidences.length > 0 && (
                  <div style={{ marginTop: "8px", paddingLeft: "4px", display: "flex", flexDirection: "column", gap: "6px" }}>
                    {d.evidences.map((e) => (
                      <div key={e.id} style={{ display: "flex", alignItems: "center", gap: "8px", fontSize: "12px" }}>
                        <span style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: "20px",
                          height: "20px",
                          borderRadius: "4px",
                          background: e.party === "reporter" ? "rgba(245,158,11,0.1)" : "rgba(59,130,246,0.1)",
                          color: e.party === "reporter" ? "#f59e0b" : "#3b82f6",
                          fontSize: "10px",
                          fontWeight: 700,
                        }}>
                          {e.party === "reporter" ? "R" : "C"}
                        </span>
                        {e.evidenceURI ? (
                          <a href={e.evidenceURI} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
                            {e.title || e.description || "Evidence"}
                          </a>
                        ) : (
                          <span style={{ color: "#cbd5e1" }}>
                            {e.title || e.description || "Evidence"}
                          </span>
                        )}
                        {e.kind && (
                          <span style={{ opacity: 0.45, textTransform: "uppercase", letterSpacing: "0.3px" }}>
                            {e.kind.replaceAll("_", " ")}
                          </span>
                        )}
                        <span style={{ opacity: 0.3, fontFamily: "monospace", fontSize: "11px" }}>
                          {e.submitter.slice(0, 6)}...{e.submitter.slice(-4)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Parties & Stake */}
                <div style={{ display: "flex", gap: "20px", marginTop: "14px", fontSize: "12px", flexWrap: "wrap" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ opacity: 0.35, textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.3px" }}>Reporter</span>
                    <span style={{ fontFamily: "monospace", fontSize: "11px", opacity: 0.65 }}>
                      {d.reporterAddr.slice(0, 6)}...{d.reporterAddr.slice(-4)}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ opacity: 0.35, textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.3px" }}>Creator</span>
                    <span style={{ fontFamily: "monospace", fontSize: "11px", opacity: 0.65 }}>
                      {d.creatorAddr.slice(0, 6)}...{d.creatorAddr.slice(-4)}
                    </span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                    <span style={{ opacity: 0.35, textTransform: "uppercase", fontSize: "10px", letterSpacing: "0.3px" }}>Stake</span>
                    <span style={{ fontFamily: "monospace", fontSize: "11px", color: "#f59e0b", fontWeight: 600 }}>
                      {stakeDisplay}
                    </span>
                  </div>
                </div>

                {/* Actions */}
                <div style={actionsRowStyle}>
                  <div>
                    {d.status.toLowerCase() !== "review" && (
                      <button
                        onClick={() => markUnderReview(d.id)}
                        disabled={actionLoading === d.id}
                        style={{ ...actionBtnStyle, borderColor: "rgba(139,92,246,0.3)", color: "#8b5cf6", background: "rgba(139,92,246,0.06)" }}
                      >
                        {actionLoading === d.id ? "..." : "Mark Under Review"}
                      </button>
                    )}
                  </div>
                  <div style={{ display: "flex", gap: "8px" }}>
                    <button
                      onClick={() => setConfirmAction({ id: d.id, outcome: "upheld" })}
                      disabled={actionLoading === d.id}
                      style={{ ...actionBtnStyle, borderColor: "rgba(16,185,129,0.3)", color: "#10b981", background: "rgba(16,185,129,0.06)" }}
                    >
                      Upheld
                    </button>
                    <button
                      onClick={() => setConfirmAction({ id: d.id, outcome: "rejected" })}
                      disabled={actionLoading === d.id}
                      style={{ ...actionBtnStyle, borderColor: "rgba(239,68,68,0.3)", color: "#ef4444", background: "rgba(239,68,68,0.06)" }}
                    >
                      Rejected
                    </button>
                    <button
                      onClick={() => setConfirmAction({ id: d.id, outcome: "inconclusive" })}
                      disabled={actionLoading === d.id}
                      style={{ ...actionBtnStyle, borderColor: "rgba(245,158,11,0.3)", color: "#f59e0b", background: "rgba(245,158,11,0.06)" }}
                    >
                      Inconclusive
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Confirm Dialog */}
      {confirmAction && (
        <ConfirmDialog
          isOpen
          title={outcomeConfig[confirmAction.outcome]?.label || "Resolve Dispute"}
          message={outcomeConfig[confirmAction.outcome]?.message || "Are you sure?"}
          confirmLabel="Confirm"
          cancelLabel="Cancel"
          variant={outcomeConfig[confirmAction.outcome]?.variant || "default"}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */

const containerStyle: React.CSSProperties = {
  maxWidth: "900px",
  margin: "0 auto",
  padding: "20px",
  paddingBottom: "80px",
};

const headerStyle: React.CSSProperties = {
  paddingBottom: "20px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  marginBottom: "24px",
};

const pendingBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  padding: "4px 12px",
  borderRadius: "999px",
  background: "rgba(245,158,11,0.12)",
  color: "#f59e0b",
  fontSize: "12px",
  fontWeight: 600,
};

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.025)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderLeft: "3px solid transparent",
  borderRadius: "14px",
  padding: "18px 20px",
  transition: "border-color 0.2s",
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

const priorityBadgeBase: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "5px",
  padding: "2px 8px",
  borderRadius: "6px",
  border: "1px solid",
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const linkStyle: React.CSSProperties = {
  color: "#60a5fa",
  fontSize: "13px",
  textDecoration: "none",
  display: "inline-flex",
  alignItems: "center",
  gap: "6px",
};

const expandBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "6px",
  padding: "2px 10px",
  fontSize: "11px",
  color: "rgba(255,255,255,0.5)",
  cursor: "pointer",
  transition: "all 0.15s",
};

const actionsRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "8px",
  marginTop: "16px",
  paddingTop: "14px",
  borderTop: "1px solid rgba(255,255,255,0.04)",
};

const actionBtnStyle: React.CSSProperties = {
  border: "1px solid",
  borderRadius: "8px",
  padding: "8px 14px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s",
};
