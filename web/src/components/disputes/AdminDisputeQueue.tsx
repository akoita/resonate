"use client";

import { useState, useEffect, useCallback } from "react";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { formatEth } from "../../lib/stakeConstants";
import { useAuth } from "../auth/AuthProvider";
import { useWebSockets, type ReleaseRightsRequestUpdate } from "../../hooks/useWebSockets";
import {
  listPendingReleaseRightsUpgradeRequests,
  reviewReleaseRightsUpgradeRequest,
  type ReleaseRightsUpgradeRequestRecord,
  type ReleaseRightsUpgradeRequestStatus,
} from "../../lib/api";

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

type RightsUpgradeAction =
  | "under_review"
  | "more_evidence_requested"
  | "approved_standard_escrow"
  | "approved_trusted_fast_path"
  | "denied";

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

function formatRightsUpgradeStatusLabel(status: string) {
  switch (status) {
    case "submitted":
      return "Submitted";
    case "under_review":
      return "Under Review";
    case "more_evidence_requested":
      return "More Evidence Needed";
    case "approved_standard_escrow":
      return "Approved: Standard Escrow";
    case "approved_trusted_fast_path":
      return "Approved: Trusted Fast Path";
    case "denied":
      return "Denied";
    default:
      return status.replaceAll("_", " ");
  }
}

function formatDerivedRightsStateLabel(status?: string | null) {
  switch (status) {
    case "platform_review_pending":
      return "Review pending";
    case "platform_reviewed":
      return "Platform reviewed";
    case "rights_verified":
      return "Rights verified";
    case "rights_disputed":
      return "Rights disputed";
    default:
      return "Not independently reviewed";
  }
}

function compactUrlLabel(value?: string | null) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    const path = parsed.pathname.length > 42 ? `${parsed.pathname.slice(0, 39)}…` : parsed.pathname;
    return `${parsed.hostname}${path}`;
  } catch {
    return value.length > 48 ? `${value.slice(0, 45)}…` : value;
  }
}

export default function AdminDisputeQueue() {
  const { token } = useAuth();
  const { addToast } = useToast();
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [rightsRequests, setRightsRequests] = useState<ReleaseRightsUpgradeRequestRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());
  const [confirmAction, setConfirmAction] = useState<{ id: string; outcome: string } | null>(null);

  const fetchPending = useCallback(async (options?: { silent?: boolean }) => {
    if (!options?.silent) {
      setLoading(true);
    }
    try {
      const [disputeRes, pendingRights] = await Promise.all([
        fetch("/api/metadata/disputes/pending?limit=50"),
        token ? listPendingReleaseRightsUpgradeRequests(token, 50) : Promise.resolve([]),
      ]);

      if (disputeRes.ok) setDisputes(await disputeRes.json());
      setRightsRequests(pendingRights);
    } finally {
      if (!options?.silent) {
        setLoading(false);
      }
    }
  }, [token]);

  useEffect(() => {
    fetchPending();
  }, [fetchPending]);

  const handleReleaseRightsRealtimeUpdate = useCallback((update: ReleaseRightsRequestUpdate) => {
    if (!token) return;

    void fetchPending({ silent: true });

    if (update.status === "submitted") {
      addToast({
        type: "info",
        title: "New marketplace-rights request",
        message: "A creator submitted a release for marketplace-rights review.",
      });
    }
  }, [addToast, fetchPending, token]);

  useWebSockets(
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    handleReleaseRightsRealtimeUpdate,
  );

  const reviewRightsRequest = async (
    id: string,
    action: RightsUpgradeAction,
    decisionReason?: string,
  ) => {
    if (!token) return;
    setActionLoading(id);
    try {
      const updatedRequest = await reviewReleaseRightsUpgradeRequest(
        id,
        {
          action: action as ReleaseRightsUpgradeRequestStatus,
          decisionReason,
        },
        token,
      );
      addToast({
        type: "success",
        title: "Review updated",
        message: `Release rights request is now ${formatRightsUpgradeStatusLabel(updatedRequest.status)}.`,
      });
      await fetchPending({ silent: true });
    } catch (error) {
      addToast({
        type: "error",
        title: "Review failed",
        message: error instanceof Error ? error.message : "Could not update the release-rights request.",
      });
    } finally {
      setActionLoading(null);
    }
  };

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
        .adq-action-btn:not(:disabled):hover {
          filter: brightness(1.2);
          transform: translateY(-1px);
        }
        .adq-action-btn:disabled {
          opacity: 0.45 !important;
          cursor: not-allowed !important;
          filter: grayscale(0.4);
        }
        .adq-card:hover {
          border-color: rgba(255,255,255,0.1);
        }
        .adq-evidence-card:hover {
          background: rgba(255,255,255,0.04);
          border-color: rgba(255,255,255,0.1);
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
              {disputes.length + rightsRequests.length} pending
            </span>
          </div>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>
            Review pending content disputes and release-rights upgrade requests
          </p>
        </div>
      </div>

      {rightsRequests.length > 0 && (
        <section style={{ marginBottom: "26px" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "12px" }}>
            <div>
              <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 700 }}>Release Rights Requests</h2>
              <p style={{ margin: "4px 0 0", fontSize: "12px", color: "rgba(255,255,255,0.42)" }}>
                Creator submissions requesting marketplace access for restricted releases.
              </p>
            </div>
            <span style={{ ...pendingBadgeStyle, background: "rgba(124,92,255,0.12)", color: "#a78bfa" }}>
              {rightsRequests.length} requests
            </span>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            {rightsRequests.map((request) => (
              <div key={request.id} className="adq-card" style={{ ...cardStyle, borderLeftColor: "#a78bfa" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "12px", flexWrap: "wrap" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginBottom: "6px" }}>
                      <span style={{ fontWeight: 700, fontSize: "14px" }}>
                        {request.release?.title || request.releaseId}
                      </span>
                      <span style={{ ...badgeStyle, borderColor: "#a78bfa", color: "#a78bfa" }}>
                        {formatRightsUpgradeStatusLabel(request.status)}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap", marginTop: "4px" }}>
                      <span style={routeChipStyle}>
                        {request.currentRouteAtSubmission?.replaceAll("_", " ") || "unknown"}
                      </span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,0.3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="5" y1="12" x2="19" y2="12" /><polyline points="12 5 19 12 12 19" /></svg>
                      <span style={{ ...routeChipStyle, borderColor: "rgba(124,92,255,0.25)", color: "#a78bfa" }}>
                        {request.requestedRoute.replaceAll("_", " ")}
                      </span>
                      {request.derivedRightsVerificationStatus && request.derivedRightsVerificationStatus !== "not_independently_reviewed" && (
                        <span style={{
                          padding: "2px 8px",
                          borderRadius: "6px",
                          fontSize: "10px",
                          fontWeight: 600,
                          textTransform: "uppercase",
                          letterSpacing: "0.04em",
                          background: request.derivedRightsVerificationStatus === "rights_verified" ? "rgba(16,185,129,0.1)" :
                            request.derivedRightsVerificationStatus === "rights_disputed" ? "rgba(239,68,68,0.1)" :
                              "rgba(245,158,11,0.1)",
                          color: request.derivedRightsVerificationStatus === "rights_verified" ? "#10b981" :
                            request.derivedRightsVerificationStatus === "rights_disputed" ? "#ef4444" :
                              "#f59e0b",
                        }}>
                          {formatDerivedRightsStateLabel(request.derivedRightsVerificationStatus)}
                        </span>
                      )}
                    </div>
                  </div>
                  <span style={{ fontSize: "12px", opacity: 0.35, whiteSpace: "nowrap" }}>
                    {new Date(request.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {request.summary && (
                  <div style={summaryBlockStyle}>
                    <div style={sectionLabelStyle}>Creator summary</div>
                    <div style={{ fontSize: "13px", lineHeight: 1.55, color: "rgba(255,255,255,0.78)" }}>
                      {request.summary}
                    </div>
                  </div>
                )}

                {request.decisionReason && (
                  <div style={reviewerNoteStyle}>
                    <div style={sectionLabelStyle}>Latest reviewer note</div>
                    <div style={{ fontSize: "12px", lineHeight: 1.5, color: "rgba(255,255,255,0.64)" }}>
                      {request.decisionReason}
                    </div>
                  </div>
                )}

                {request.evidenceBundles && request.evidenceBundles.length > 0 && (
                  <div style={{ marginTop: "14px", display: "flex", flexDirection: "column", gap: "10px" }}>
                    <div style={sectionLabelStyle}>Evidence packet</div>
                    {request.evidenceBundles.flatMap((bundle) => bundle.evidences).slice(0, 4).map((evidence) => (
                      <div
                        key={evidence.id}
                        className="adq-evidence-card"
                        style={evidenceCardStyle}
                      >
                        <div style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                            <span style={{ ...badgeStyle, borderColor: "rgba(167,139,250,0.25)", color: "#a78bfa", background: "rgba(167,139,250,0.06)" }}>
                              {evidence.kind.replaceAll("_", " ")}
                            </span>
                            {evidence.strength && (
                              <span style={{
                                ...badgeStyle,
                                borderColor: evidence.strength === "very_high" || evidence.strength === "high" ? "rgba(16,185,129,0.25)" : "rgba(245,158,11,0.25)",
                                color: evidence.strength === "very_high" ? "#10b981" : evidence.strength === "high" ? "#34d399" : "#f59e0b",
                                background: evidence.strength === "very_high" || evidence.strength === "high" ? "rgba(16,185,129,0.06)" : "rgba(245,158,11,0.06)",
                              }}>
                                {evidence.strength.replaceAll("_", " ")}
                              </span>
                            )}
                          </div>
                          <div style={{ display: "flex", alignItems: "baseline", gap: "10px", flexWrap: "wrap" }}>
                            <span style={{ fontSize: "14px", fontWeight: 600, color: "rgba(255,255,255,0.9)" }}>
                              {evidence.title}
                            </span>
                            {evidence.sourceUrl && (
                              <a href={evidence.sourceUrl} target="_blank" rel="noopener noreferrer" style={{ ...linkStyle, fontSize: "12px" }}>
                                <IconLink size={12} />
                                <span>{compactUrlLabel(evidence.sourceUrl)}</span>
                              </a>
                            )}
                          </div>
                        </div>

                        <div style={evidenceMetaGridStyle}>
                          {evidence.claimedRightsholder && (
                            <div style={evidenceMetaItemStyle}>
                              <span style={evidenceMetaLabelStyle}>Rightsholder</span>
                              <span style={evidenceMetaValueStyle}>{evidence.claimedRightsholder}</span>
                            </div>
                          )}
                          {evidence.artistName && (
                            <div style={evidenceMetaItemStyle}>
                              <span style={evidenceMetaLabelStyle}>Artist</span>
                              <span style={evidenceMetaValueStyle}>{evidence.artistName}</span>
                            </div>
                          )}
                          {evidence.sourceLabel && (
                            <div style={evidenceMetaItemStyle}>
                              <span style={evidenceMetaLabelStyle}>Source</span>
                              <span style={evidenceMetaValueStyle}>{evidence.sourceLabel}</span>
                            </div>
                          )}
                          {evidence.publicationDate && (
                            <div style={evidenceMetaItemStyle}>
                              <span style={evidenceMetaLabelStyle}>Published</span>
                              <span style={evidenceMetaValueStyle}>
                                {new Date(evidence.publicationDate).toLocaleDateString()}
                              </span>
                            </div>
                          )}
                          {evidence.isrc && (
                            <div style={evidenceMetaItemStyle}>
                              <span style={evidenceMetaLabelStyle}>ISRC</span>
                              <span style={{ ...evidenceMetaValueStyle, fontFamily: "monospace", fontSize: "11px" }}>{evidence.isrc}</span>
                            </div>
                          )}
                          {evidence.upc && (
                            <div style={evidenceMetaItemStyle}>
                              <span style={evidenceMetaLabelStyle}>UPC</span>
                              <span style={{ ...evidenceMetaValueStyle, fontFamily: "monospace", fontSize: "11px" }}>{evidence.upc}</span>
                            </div>
                          )}
                          {/* strength shown as badge in header */}
                          {evidence.attachments && evidence.attachments.length > 0 && (
                            <div style={evidenceMetaItemStyle}>
                              <span style={evidenceMetaLabelStyle}>Documents</span>
                              <span style={evidenceMetaValueStyle}>
                                {evidence.attachments.length} attached
                              </span>
                            </div>
                          )}
                        </div>

                        {evidence.description && (
                          <div style={{
                            fontSize: "12px",
                            lineHeight: 1.55,
                            color: "rgba(255,255,255,0.6)",
                            padding: "8px 10px",
                            background: "rgba(255,255,255,0.02)",
                            borderRadius: "8px",
                            borderLeft: "2px solid rgba(255,255,255,0.06)",
                          }}>
                            {evidence.description}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {/* ── Actions ─────────────────────────────────────── */}
                <div style={actionsContainerStyle}>
                  {/* Triage row */}
                  <div style={actionGroupStyle}>
                    <span style={actionGroupLabelStyle}>Triage</span>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        className="adq-action-btn"
                        onClick={() => reviewRightsRequest(request.id, "under_review")}
                        disabled={actionLoading === request.id}
                        style={{ ...actionBtnStyle, borderColor: "rgba(139,92,246,0.3)", color: "#8b5cf6", background: "rgba(139,92,246,0.06)" }}
                      >
                        {actionLoading === request.id ? "..." : "Under Review"}
                      </button>
                      <button
                        className="adq-action-btn"
                        onClick={() =>
                          reviewRightsRequest(
                            request.id,
                            "more_evidence_requested",
                            "Please provide stronger proof linking this wallet to the official artist or release profile.",
                          )
                        }
                        disabled={actionLoading === request.id}
                        style={{ ...actionBtnStyle, borderColor: "rgba(245,158,11,0.3)", color: "#f59e0b", background: "rgba(245,158,11,0.06)" }}
                      >
                        {actionLoading === request.id ? "..." : "Need Evidence"}
                      </button>
                    </div>
                  </div>

                  {/* Decision row */}
                  <div style={actionGroupStyle}>
                    <span style={actionGroupLabelStyle}>Decision</span>
                    <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
                      <button
                        className="adq-action-btn"
                        onClick={() =>
                          reviewRightsRequest(
                            request.id,
                            "approved_standard_escrow",
                            "Marketplace access approved under the standard escrow path after release rights review.",
                          )
                        }
                        disabled={actionLoading === request.id}
                        style={{ ...actionBtnStyle, borderColor: "rgba(16,185,129,0.3)", color: "#10b981", background: "rgba(16,185,129,0.06)" }}
                      >
                        {actionLoading === request.id ? "..." : "Approve (Escrow)"}
                      </button>
                      <button
                        className="adq-action-btn"
                        onClick={() =>
                          reviewRightsRequest(
                            request.id,
                            "approved_trusted_fast_path",
                            "Marketplace access approved under the trusted fast path after release rights review.",
                          )
                        }
                        disabled={actionLoading === request.id}
                        style={{ ...actionBtnStyle, borderColor: "rgba(34,197,94,0.3)", color: "#4ade80", background: "rgba(34,197,94,0.06)" }}
                      >
                        {actionLoading === request.id ? "..." : "Verify Rights"}
                      </button>
                      <button
                        className="adq-action-btn"
                        onClick={() =>
                          reviewRightsRequest(
                            request.id,
                            "denied",
                            "The submitted proof was not sufficient to unlock marketplace access for this release.",
                          )
                        }
                        disabled={actionLoading === request.id}
                        style={{ ...actionBtnStyle, borderColor: "rgba(239,68,68,0.3)", color: "#ef4444", background: "rgba(239,68,68,0.06)" }}
                      >
                        {actionLoading === request.id ? "..." : "Deny"}
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Content */}
      {disputes.length === 0 && rightsRequests.length === 0 ? (
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
          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.3)" }}>No disputes or release-rights reviews require attention right now</div>
        </div>
      ) : disputes.length > 0 ? (
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
              <div key={d.id} className="adq-card" style={{ ...cardStyle, borderLeftColor: statusColor(d.status) }}>
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
                        className="adq-action-btn"
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
                      className="adq-action-btn"
                      onClick={() => setConfirmAction({ id: d.id, outcome: "upheld" })}
                      disabled={actionLoading === d.id}
                      style={{ ...actionBtnStyle, borderColor: "rgba(16,185,129,0.3)", color: "#10b981", background: "rgba(16,185,129,0.06)" }}
                    >
                      Upheld
                    </button>
                    <button
                      className="adq-action-btn"
                      onClick={() => setConfirmAction({ id: d.id, outcome: "rejected" })}
                      disabled={actionLoading === d.id}
                      style={{ ...actionBtnStyle, borderColor: "rgba(239,68,68,0.3)", color: "#ef4444", background: "rgba(239,68,68,0.06)" }}
                    >
                      Rejected
                    </button>
                    <button
                      className="adq-action-btn"
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
      ) : null}

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
  transition: "border-color 0.2s, background 0.2s",
};

const sectionLabelStyle: React.CSSProperties = {
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "rgba(255,255,255,0.42)",
  fontWeight: 600,
};

const summaryBlockStyle: React.CSSProperties = {
  marginTop: "10px",
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const reviewerNoteStyle: React.CSSProperties = {
  marginTop: "10px",
  padding: "10px 12px",
  borderRadius: "10px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.05)",
  display: "flex",
  flexDirection: "column",
  gap: "4px",
};

const evidenceCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  padding: "12px 14px",
  borderRadius: "12px",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.05)",
  transition: "background 0.15s, border-color 0.15s",
};

const evidenceMetaGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
  gap: "8px 12px",
};

const evidenceMetaItemStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "3px",
  minWidth: 0,
};

const evidenceMetaLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  textTransform: "uppercase",
  letterSpacing: "0.06em",
  color: "rgba(255,255,255,0.36)",
};

const evidenceMetaValueStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "rgba(255,255,255,0.74)",
  wordBreak: "break-word",
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

const routeChipStyle: React.CSSProperties = {
  padding: "2px 8px",
  borderRadius: "6px",
  fontSize: "11px",
  fontWeight: 500,
  border: "1px solid rgba(255,255,255,0.1)",
  color: "rgba(255,255,255,0.55)",
  textTransform: "uppercase" as const,
  letterSpacing: "0.03em",
};

const actionsContainerStyle: React.CSSProperties = {
  marginTop: "14px",
  paddingTop: "14px",
  borderTop: "1px solid rgba(255,255,255,0.04)",
  display: "flex",
  gap: "16px",
  flexWrap: "wrap",
};

const actionGroupStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "6px",
};

const actionGroupLabelStyle: React.CSSProperties = {
  fontSize: "9px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "rgba(255,255,255,0.28)",
};

const actionBtnStyle: React.CSSProperties = {
  border: "1px solid",
  borderRadius: "8px",
  padding: "8px 14px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s",
  opacity: 1,
};

const actionHintStyle: React.CSSProperties = {
  maxWidth: "360px",
  fontSize: "11px",
  lineHeight: 1.45,
  color: "rgba(255,255,255,0.42)",
  textAlign: "right",
};
