"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { useDisputeNotifications } from "../../hooks/useDisputeNotifications";

interface DisputeEvidence {
  id: string;
  submitter: string;
  party: string;
  evidenceURI: string;
  description: string | null;
  createdAt: string;
}

interface JuryAssignment {
  id: string;
  jurorAddr: string;
  vote: "reporter" | "creator" | null;
  assignedAt: string;
  votedAt: string | null;
}

interface Dispute {
  id: string;
  disputeIdOnChain?: string | null;
  tokenId: string;
  reporterAddr: string;
  creatorAddr: string;
  status: string;
  outcome: string | null;
  evidenceURI: string;
  counterStake: string;
  resolvedAt: string | null;
  createdAt: string;
  escalatedToJuryAt?: string | null;
  juryDeadlineAt?: string | null;
  jurySize?: number | null;
  juryVotesForReporter?: number;
  juryVotesForCreator?: number;
  juryFinalizedAt?: string | null;
  evidences: DisputeEvidence[];
  juryAssignments: JuryAssignment[];
}

type Tab = "reporter" | "creator" | "juror";

/* ── Inline SVG Icons ──────────────────────────────────────────── */

function IconScale() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 3v18" />
      <path d="M5 7l7-4 7 4" />
      <path d="M2 14l3-7 3 7a5 5 0 0 1-6 0z" />
      <path d="M16 14l3-7 3 7a5 5 0 0 1-6 0z" />
    </svg>
  );
}

function IconMegaphone({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 11l18-5v12L3 13v-2z" />
      <path d="M11.6 16.8a3 3 0 1 1-5.8-1.6" />
    </svg>
  );
}

function IconShield({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
    </svg>
  );
}

function IconBallot({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d="M9 12l2 2 4-4" />
    </svg>
  );
}

function IconCopy({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function IconCheck({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="20 6 9 17 4 12" />
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

function IconChevron({ down = true, size = 14 }: { down?: boolean; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ transition: "transform 0.2s", transform: down ? "rotate(0deg)" : "rotate(-90deg)" }}
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function IconUser({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
      <circle cx="12" cy="7" r="4" />
    </svg>
  );
}

/* ── Lifecycle Stepper ─────────────────────────────────────────── */

const LIFECYCLE_STEPS = ["Filed", "Evidence", "Review", "Jury", "Resolved"] as const;
const LIFECYCLE_INDEX: Record<string, number> = {
  filed: 0,
  evidence: 1,
  review: 2,
  escalated: 3,
  jury_voting: 3,
  resolved: 4,
  appealed: 4,
};

function LifecycleStepper({ status, outcome }: { status: string; outcome: string | null }) {
  const currentIdx = LIFECYCLE_INDEX[status.toLowerCase()] ?? 0;
  const isAppealed = status.toLowerCase() === "appealed";

  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0", marginBottom: "16px" }}>
      {LIFECYCLE_STEPS.map((step, i) => {
        const isCompleted = i < currentIdx;
        const isCurrent = i === currentIdx;
        const dotColor = isCurrent && isAppealed
          ? "#f97316"
          : isCurrent
            ? statusColorMap[status.toLowerCase()] || "#6b7280"
            : isCompleted
              ? "#10b981"
              : "rgba(255,255,255,0.12)";

        return (
          <div key={step} style={{ display: "flex", alignItems: "center", flex: i < LIFECYCLE_STEPS.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
              <div
                style={{
                  width: isCurrent ? "14px" : "10px",
                  height: isCurrent ? "14px" : "10px",
                  borderRadius: "50%",
                  background: isCompleted || isCurrent ? dotColor : "transparent",
                  border: isCompleted || isCurrent ? "none" : `2px solid rgba(255,255,255,0.15)`,
                  boxShadow: isCurrent ? `0 0 8px ${dotColor}60` : "none",
                  animation: isCurrent ? "stepper-pulse 2s ease-in-out infinite" : "none",
                  transition: "all 0.3s",
                }}
              />
              <span style={{
                fontSize: "9px",
                fontWeight: isCurrent ? 700 : 500,
                color: isCurrent ? "#fff" : isCompleted ? "rgba(255,255,255,0.6)" : "rgba(255,255,255,0.25)",
                textTransform: "uppercase",
                letterSpacing: "0.5px",
                whiteSpace: "nowrap",
              }}>
                {step}
              </span>
            </div>
            {i < LIFECYCLE_STEPS.length - 1 && (
              <div style={{
                flex: 1,
                height: "2px",
                background: i < currentIdx ? "#10b981" : "rgba(255,255,255,0.08)",
                marginBottom: "18px",
                marginLeft: "4px",
                marginRight: "4px",
                borderRadius: "1px",
                transition: "background 0.3s",
              }} />
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ── Score Ring ─────────────────────────────────────────────────── */

function ScoreRing({ score, maxScore = 50 }: { score: number; maxScore?: number }) {
  const radius = 24;
  const circumference = 2 * Math.PI * radius;
  const clampedScore = Math.min(Math.abs(score), maxScore);
  const progress = (clampedScore / maxScore) * circumference;
  const color = score > 0 ? "#10b981" : score < 0 ? "#ef4444" : "#6b7280";

  return (
    <svg width="56" height="56" viewBox="0 0 56 56">
      <circle cx="28" cy="28" r={radius} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth="4" />
      <circle
        cx="28"
        cy="28"
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth="4"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference - progress}
        transform="rotate(-90 28 28)"
        style={{ transition: "stroke-dashoffset 0.6s ease" }}
      />
      <text x="28" y="32" textAnchor="middle" fill={color} fontSize="16" fontWeight="700">
        {score}
      </text>
    </svg>
  );
}

/* ── Status color map ──────────────────────────────────────────── */

const statusColorMap: Record<string, string> = {
  filed: "#f59e0b",
  evidence: "#3b82f6",
  review: "#8b5cf6",
  escalated: "#ec4899",
  jury_voting: "#14b8a6",
  resolved: "#10b981",
  appealed: "#f97316",
};

const outcomeColorMap: Record<string, string> = {
  upheld: "#10b981",
  rejected: "#ef4444",
  inconclusive: "#f59e0b",
};

export default function DisputeDashboard() {
  const { address } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { disputeUpdate } = useDisputeNotifications(address ?? undefined);
  const requestedTab = searchParams.get("tab");
  const highlightedDisputeId = searchParams.get("dispute");
  const initialTab: Tab =
    requestedTab === "creator" || requestedTab === "juror" || requestedTab === "reporter"
      ? requestedTab
      : "reporter";
  const [tab, setTab] = useState<Tab>(initialTab);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [loading, setLoading] = useState(false);
  const [votePendingId, setVotePendingId] = useState<string | null>(null);
  const [reputation, setReputation] = useState({
    score: 0,
    effectiveScore: 0,
    successfulFlags: 0,
    rejectedFlags: 0,
    requiresHumanVerification: false,
  });
  const highlightedCardRef = useRef<HTMLDivElement | null>(null);

  // New states for collapsible sections & clipboard
  const [expandedTimelines, setExpandedTimelines] = useState<Set<string>>(new Set());
  const [expandedJuryPanels, setExpandedJuryPanels] = useState<Set<string>>(new Set());
  const [expandedEvidence, setExpandedEvidence] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [tabCounts, setTabCounts] = useState({ reporter: 0, creator: 0, juror: 0 });

  const toggleSet = useCallback((current: Set<string>, setter: React.Dispatch<React.SetStateAction<Set<string>>>, id: string) => {
    setter((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const copyToClipboard = useCallback((text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }, []);

  const statusColor = (status: string) => statusColorMap[status.toLowerCase()] || "#6b7280";
  const outcomeColor = (outcome: string | null) => (outcome ? outcomeColorMap[outcome] || "#6b7280" : "#6b7280");

  const updateTab = useCallback((nextTab: Tab) => {
    setTab(nextTab);
    const params = new URLSearchParams(searchParams.toString());
    if (nextTab === "reporter") {
      params.delete("tab");
    } else {
      params.set("tab", nextTab);
    }
    const nextQuery = params.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
  }, [pathname, router, searchParams]);

  const fetchDisputes = useCallback(async () => {
    if (!address) return;
    setLoading(true);
    try {
      const endpoint =
        tab === "reporter"
          ? `/api/metadata/disputes/reporter/${address}`
          : tab === "creator"
            ? `/api/metadata/disputes/creator/${address}`
            : `/api/metadata/disputes/juror/${address}`;
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

  const fetchTabCounts = useCallback(async () => {
    if (!address) return;
    try {
      const [reporterRes, creatorRes, jurorRes] = await Promise.all([
        fetch(`/api/metadata/disputes/reporter/${address}`),
        fetch(`/api/metadata/disputes/creator/${address}`),
        fetch(`/api/metadata/disputes/juror/${address}`),
      ]);
      const [reporter, creator, juror] = await Promise.all([
        reporterRes.ok ? reporterRes.json() : [],
        creatorRes.ok ? creatorRes.json() : [],
        jurorRes.ok ? jurorRes.json() : [],
      ]);
      setTabCounts({
        reporter: reporter.length,
        creator: creator.length,
        juror: juror.length,
      });
    } catch {
      // silent
    }
  }, [address]);

  useEffect(() => {
    fetchDisputes();
  }, [fetchDisputes]);

  useEffect(() => {
    if (requestedTab === "creator" || requestedTab === "juror" || requestedTab === "reporter") {
      setTab(requestedTab);
      return;
    }
    setTab("reporter");
  }, [requestedTab]);

  useEffect(() => {
    if (!highlightedDisputeId || !disputes.length) return;
    const hasHighlightedDispute = disputes.some(
      (dispute) => dispute.disputeIdOnChain === highlightedDisputeId || dispute.id === highlightedDisputeId,
    );
    if (!hasHighlightedDispute || !highlightedCardRef.current) return;
    const card = highlightedCardRef.current;
    const timer = window.setTimeout(() => {
      card.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 120);
    return () => window.clearTimeout(timer);
  }, [disputes, highlightedDisputeId]);

  useEffect(() => {
    fetchReputation();
    fetchTabCounts();
  }, [fetchReputation, fetchTabCounts]);

  useEffect(() => {
    if (disputeUpdate) {
      fetchDisputes();
      fetchTabCounts();
    }
  }, [disputeUpdate, fetchDisputes, fetchTabCounts]);

  // Auto-expand jury panels where user needs to vote
  useEffect(() => {
    if (!address || !disputes.length) return;
    const needsVote = new Set<string>();
    for (const d of disputes) {
      const myAssignment = d.juryAssignments.find(
        (a) => a.jurorAddr.toLowerCase() === address.toLowerCase()
      );
      if (myAssignment && !myAssignment.vote && ["escalated", "jury_voting"].includes(d.status.toLowerCase())) {
        needsVote.add(d.id);
      }
    }
    if (needsVote.size > 0) {
      setExpandedJuryPanels((prev) => new Set([...prev, ...needsVote]));
    }
  }, [address, disputes]);

  const castJuryVote = useCallback(
    async (disputeId: string, vote: "reporter" | "creator") => {
      if (!address) return;
      setVotePendingId(disputeId);
      try {
        const res = await fetch(`/api/metadata/disputes/${disputeId}/jury-vote`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jurorAddr: address, vote }),
        });
        if (!res.ok) throw new Error("Vote failed");
        await fetchDisputes();
      } catch {
        window.alert("Unable to submit jury vote.");
      } finally {
        setVotePendingId(null);
      }
    },
    [address, fetchDisputes],
  );

  /* ── Render helpers ──────────────────────────────────────────── */

  const renderTimeline = (d: Dispute) => {
    const events: { label: string; date: string; color: string }[] = [
      { label: "Filed", date: d.createdAt, color: "#f59e0b" },
    ];
    if (d.escalatedToJuryAt) events.push({ label: "Escalated to jury", date: d.escalatedToJuryAt, color: "#ec4899" });
    if (d.juryDeadlineAt) events.push({ label: "Voting deadline", date: d.juryDeadlineAt, color: "#14b8a6" });
    if (d.juryFinalizedAt) events.push({ label: "Jury finalized", date: d.juryFinalizedAt, color: "#10b981" });
    if (d.resolvedAt) events.push({ label: "Resolved", date: d.resolvedAt, color: "#10b981" });

    return (
      <div style={{ position: "relative", paddingLeft: "20px" }}>
        {/* Vertical connecting line */}
        <div style={{
          position: "absolute",
          left: "4px",
          top: "4px",
          bottom: "4px",
          width: "2px",
          background: "rgba(255,255,255,0.06)",
          borderRadius: "1px",
        }} />
        {events.map((event, i) => (
          <div key={i} style={{ position: "relative", paddingBottom: i < events.length - 1 ? "12px" : "0" }}>
            {/* Dot */}
            <div style={{
              position: "absolute",
              left: "-20px",
              top: "4px",
              width: "10px",
              height: "10px",
              borderRadius: "50%",
              background: event.color,
              boxShadow: `0 0 6px ${event.color}40`,
            }} />
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: "12px" }}>
              <span style={{ fontSize: "12px", color: "rgba(255,255,255,0.75)", fontWeight: 500 }}>{event.label}</span>
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", whiteSpace: "nowrap" }}>
                {new Date(event.date).toLocaleString()}
              </span>
            </div>
          </div>
        ))}
      </div>
    );
  };

  const renderVoteTally = (d: Dispute) => {
    const forReporter = d.juryVotesForReporter || 0;
    const forCreator = d.juryVotesForCreator || 0;
    const total = d.jurySize || d.juryAssignments.length || 1;
    const pctReporter = (forReporter / total) * 100;
    const pctCreator = (forCreator / total) * 100;
    const pctPending = 100 - pctReporter - pctCreator;

    return (
      <div style={{ marginBottom: "12px" }}>
        <div style={{ display: "flex", justifyContent: "space-between", fontSize: "11px", marginBottom: "4px" }}>
          <span style={{ color: "#10b981" }}>Reporter {forReporter}</span>
          <span style={{ color: "rgba(255,255,255,0.35)" }}>{total - forReporter - forCreator} pending</span>
          <span style={{ color: "#ef4444" }}>Creator {forCreator}</span>
        </div>
        <div style={{ display: "flex", height: "6px", borderRadius: "3px", overflow: "hidden", background: "rgba(255,255,255,0.06)" }}>
          {pctReporter > 0 && (
            <div style={{ width: `${pctReporter}%`, background: "#10b981", transition: "width 0.3s" }} />
          )}
          {pctPending > 0 && (
            <div style={{ width: `${pctPending}%`, background: "rgba(255,255,255,0.08)" }} />
          )}
          {pctCreator > 0 && (
            <div style={{ width: `${pctCreator}%`, background: "#ef4444", transition: "width 0.3s" }} />
          )}
        </div>
      </div>
    );
  };

  const renderEmptyState = () => {
    const config = {
      reporter: {
        icon: <IconMegaphone size={32} />,
        title: "No reports filed yet",
        description: "When you report content, your disputes will appear here",
      },
      creator: {
        icon: <IconShield size={32} />,
        title: "No disputes against your content",
        description: "Your content is clear of any disputes",
      },
      juror: {
        icon: <IconBallot size={32} />,
        title: "No jury assignments yet",
        description: "When you're selected for jury duty, cases will appear here",
      },
    }[tab];

    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "60px 20px", gap: "16px" }}>
        <div style={{
          width: "72px",
          height: "72px",
          borderRadius: "18px",
          background: "rgba(255,255,255,0.04)",
          border: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "rgba(255,255,255,0.2)",
        }}>
          {config.icon}
        </div>
        <div style={{ fontSize: "16px", fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>{config.title}</div>
        <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.3)" }}>{config.description}</div>
      </div>
    );
  };

  const renderSkeletons = () => (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
      {[1, 2, 3].map((i) => (
        <div key={i} style={{
          ...cardStyle,
          borderLeftColor: "rgba(255,255,255,0.06)",
          padding: "20px",
        }}>
          <div style={{ display: "flex", gap: "12px", marginBottom: "16px" }}>
            <div style={{ width: "120px", height: "14px", borderRadius: "6px", background: "rgba(255,255,255,0.06)", animation: "skeleton-shimmer 1.5s infinite" }} />
            <div style={{ width: "60px", height: "14px", borderRadius: "6px", background: "rgba(255,255,255,0.04)", animation: "skeleton-shimmer 1.5s infinite 0.2s" }} />
          </div>
          <div style={{ display: "flex", gap: "4px", marginBottom: "12px" }}>
            {[1, 2, 3, 4, 5].map((s) => (
              <div key={s} style={{ flex: 1, display: "flex", alignItems: "center", gap: "4px" }}>
                <div style={{ width: "10px", height: "10px", borderRadius: "50%", background: "rgba(255,255,255,0.05)", animation: "skeleton-shimmer 1.5s infinite" }} />
                {s < 5 && <div style={{ flex: 1, height: "2px", background: "rgba(255,255,255,0.04)" }} />}
              </div>
            ))}
          </div>
          <div style={{ width: "80%", height: "12px", borderRadius: "4px", background: "rgba(255,255,255,0.04)", animation: "skeleton-shimmer 1.5s infinite 0.4s" }} />
        </div>
      ))}
    </div>
  );

  /* ── Main render ─────────────────────────────────────────────── */

  if (!address) {
    return (
      <div style={containerStyle}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 20px", gap: "16px" }}>
          <div style={{
            width: "72px",
            height: "72px",
            borderRadius: "18px",
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.06)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(255,255,255,0.2)",
          }}>
            <IconScale />
          </div>
          <p style={{ opacity: 0.4, fontSize: "14px" }}>Connect your wallet to view disputes</p>
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Injected keyframes */}
      <style>{`
        @keyframes stepper-pulse {
          0%, 100% { transform: scale(1); }
          50% { transform: scale(1.2); }
        }
        @keyframes skeleton-shimmer {
          0% { opacity: 0.5; }
          50% { opacity: 1; }
          100% { opacity: 0.5; }
        }
      `}</style>

      {/* ── Header ────────────────────────────────────────────── */}
      <div style={headerStyle}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            <div style={{ color: "#7c5cff" }}><IconScale /></div>
            <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px" }}>
              Dispute Center
            </h1>
          </div>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>
            Manage disputes, review evidence, serve on juries
          </p>
        </div>

        <Link href={`/curators/${address}${reputation.requiresHumanVerification ? "?verify=1" : ""}`} style={{ textDecoration: "none" }}>
          <div style={repBadgeStyle}>
            <ScoreRing score={reputation.effectiveScore} />
            <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
              <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.4)", textTransform: "uppercase", letterSpacing: "0.5px" }}>
                Reputation
              </span>
              <div style={{ display: "flex", gap: "8px" }}>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 600,
                  background: "rgba(16,185,129,0.1)",
                  color: "#10b981",
                }}>
                  {reputation.successfulFlags} upheld
                </span>
                <span style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: "4px",
                  padding: "2px 8px",
                  borderRadius: "6px",
                  fontSize: "11px",
                  fontWeight: 600,
                  background: "rgba(239,68,68,0.1)",
                  color: "#ef4444",
                }}>
                  {reputation.rejectedFlags} rejected
                </span>
              </div>
              {reputation.requiresHumanVerification && (
                <div style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#f59e0b" }}>
                  <div style={{
                    width: "6px",
                    height: "6px",
                    borderRadius: "50%",
                    background: "#f59e0b",
                    animation: "stepper-pulse 2s ease-in-out infinite",
                  }} />
                  Verification required
                </div>
              )}
            </div>
          </div>
        </Link>
      </div>

      {/* ── Tab Bar ───────────────────────────────────────────── */}
      <div style={tabBarStyle}>
        {([
          { id: "reporter" as Tab, label: "My Reports", icon: <IconMegaphone />, count: tabCounts.reporter },
          { id: "creator" as Tab, label: "Against My Content", icon: <IconShield />, count: tabCounts.creator },
          { id: "juror" as Tab, label: "Jury Duty", icon: <IconBallot />, count: tabCounts.juror },
        ]).map((t) => (
          <button
            key={t.id}
            onClick={() => updateTab(t.id)}
            style={{
              ...tabStyle,
              ...(tab === t.id ? activeTabStyle : {}),
            }}
          >
            <span style={{ color: tab === t.id ? "#fff" : "rgba(255,255,255,0.35)" }}>{t.icon}</span>
            <span>{t.label}</span>
            {t.count > 0 && (
              <span style={{
                ...countBadgeStyle,
                background: tab === t.id ? "rgba(124,92,255,0.2)" : "rgba(255,255,255,0.08)",
                color: tab === t.id ? "#c4b5fd" : "rgba(255,255,255,0.5)",
              }}>
                {t.count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ── Focus banner ──────────────────────────────────────── */}
      {highlightedDisputeId && (
        <div style={contextBannerStyle}>
          <span style={{ fontWeight: 600 }}>Focused dispute</span>
          <span style={{ opacity: 0.7 }}>
            Showing the dispute opened from your notification.
          </span>
        </div>
      )}

      {/* ── Content ───────────────────────────────────────────── */}
      {loading ? renderSkeletons() : disputes.length === 0 ? renderEmptyState() : (
        <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
          {disputes.map((d) => {
            const isHighlighted =
              highlightedDisputeId &&
              (d.disputeIdOnChain === highlightedDisputeId || d.id === highlightedDisputeId);
            const isTimelineExpanded = expandedTimelines.has(d.id);
            const isJuryExpanded = expandedJuryPanels.has(d.id);
            const isEvidenceExpanded = expandedEvidence.has(d.id);

            return (
              <div
                key={d.id}
                ref={(node) => { if (isHighlighted) highlightedCardRef.current = node; }}
                style={{
                  ...cardStyle,
                  borderLeftColor: statusColor(d.status),
                  ...(isHighlighted ? highlightedCardStyle : {}),
                }}
              >
                {/* Lifecycle stepper */}
                <LifecycleStepper status={d.status} outcome={d.outcome} />

                {/* Card header */}
                <div style={cardHeaderStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                    <span style={{ fontWeight: 600, fontSize: "14px", fontFamily: "monospace" }}>
                      Token #{d.tokenId.length > 16 ? `${d.tokenId.slice(0, 8)}...${d.tokenId.slice(-4)}` : d.tokenId}
                    </span>
                    <button
                      onClick={() => copyToClipboard(d.tokenId, `token-${d.id}`)}
                      style={copyBtnStyle}
                      title="Copy token ID"
                    >
                      {copiedId === `token-${d.id}` ? <IconCheck /> : <IconCopy />}
                    </button>
                    {isHighlighted && (
                      <span style={focusedBadgeStyle}>From notification</span>
                    )}
                    <span style={{
                      ...statusBadgeStyle,
                      borderColor: statusColor(d.status),
                      color: statusColor(d.status),
                    }}>
                      {d.status.replaceAll("_", " ").toUpperCase()}
                    </span>
                    {d.outcome && (
                      <span style={{
                        ...statusBadgeStyle,
                        borderColor: outcomeColor(d.outcome),
                        color: outcomeColor(d.outcome),
                        background: `${outcomeColor(d.outcome)}10`,
                      }}>
                        {d.outcome.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <span style={{ fontSize: "12px", opacity: 0.35, whiteSpace: "nowrap" }}>
                    {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                </div>

                {/* Evidence */}
                <div style={{ marginTop: "12px", display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" }}>
                  <a href={d.evidenceURI} target="_blank" rel="noopener noreferrer" style={linkStyle}>
                    <IconLink />
                    <span>Initial Evidence</span>
                  </a>
                  {d.evidences.length > 0 && !isEvidenceExpanded && (
                    <button
                      onClick={() => toggleSet(expandedEvidence, setExpandedEvidence, d.id)}
                      style={expandBtnStyle}
                    >
                      +{d.evidences.length} more
                    </button>
                  )}
                  {d.evidences.length > 0 && isEvidenceExpanded && (
                    <button
                      onClick={() => toggleSet(expandedEvidence, setExpandedEvidence, d.id)}
                      style={expandBtnStyle}
                    >
                      collapse
                    </button>
                  )}
                </div>

                {/* Expanded evidence */}
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
                        <a href={e.evidenceURI} target="_blank" rel="noopener noreferrer" style={{ color: "#60a5fa", textDecoration: "none" }}>
                          {e.description || "Evidence"}
                        </a>
                        <span style={{ opacity: 0.3, fontFamily: "monospace", fontSize: "11px" }}>
                          {e.submitter.slice(0, 6)}...{e.submitter.slice(-4)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {/* Collapsible Timeline */}
                <div style={sectionContainerStyle}>
                  <button
                    onClick={() => toggleSet(expandedTimelines, setExpandedTimelines, d.id)}
                    style={sectionToggleStyle}
                  >
                    <span style={{ fontSize: "12px", fontWeight: 600 }}>Arbitration Timeline</span>
                    <IconChevron down={isTimelineExpanded} />
                  </button>
                  {isTimelineExpanded && (
                    <div style={{ padding: "12px 14px 8px" }}>
                      {renderTimeline(d)}
                    </div>
                  )}
                </div>

                {/* Collapsible Jury Panel */}
                {d.juryAssignments.length > 0 && (
                  <div style={{
                    ...sectionContainerStyle,
                    background: "rgba(20,184,166,0.04)",
                    borderColor: "rgba(20,184,166,0.15)",
                  }}>
                    <button
                      onClick={() => toggleSet(expandedJuryPanels, setExpandedJuryPanels, d.id)}
                      style={sectionToggleStyle}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <span style={{ fontSize: "12px", fontWeight: 600 }}>Jury Panel</span>
                        <span style={{ fontSize: "11px", opacity: 0.45 }}>
                          {(d.juryVotesForReporter || 0) + (d.juryVotesForCreator || 0)}/{d.jurySize || d.juryAssignments.length} voted
                        </span>
                      </div>
                      <IconChevron down={isJuryExpanded} />
                    </button>
                    {isJuryExpanded && (
                      <div style={{ padding: "0 14px 14px" }}>
                        {renderVoteTally(d)}
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          {d.juryAssignments.map((assignment) => {
                            const isMe = assignment.jurorAddr.toLowerCase() === address.toLowerCase();
                            const canVote =
                              isMe &&
                              !assignment.vote &&
                              ["escalated", "jury_voting"].includes(d.status.toLowerCase());

                            return (
                              <div key={assignment.id} style={juryRowStyle}>
                                <div>
                                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                                    <span style={{ fontSize: "12px", fontFamily: "monospace" }}>
                                      {assignment.jurorAddr.slice(0, 6)}...{assignment.jurorAddr.slice(-4)}
                                    </span>
                                    {isMe && (
                                      <span style={{
                                        fontSize: "9px",
                                        fontWeight: 700,
                                        textTransform: "uppercase",
                                        padding: "1px 6px",
                                        borderRadius: "4px",
                                        background: "rgba(124,92,255,0.15)",
                                        color: "#a78bfa",
                                      }}>
                                        you
                                      </span>
                                    )}
                                  </div>
                                  <div style={{ fontSize: "11px", opacity: 0.4, marginTop: "2px" }}>
                                    {assignment.vote
                                      ? `Voted for ${assignment.vote}`
                                      : "Awaiting vote"}
                                  </div>
                                </div>
                                {canVote ? (
                                  <div style={{ display: "flex", gap: "8px" }}>
                                    <button
                                      style={{
                                        ...voteButtonStyle,
                                        borderColor: "rgba(16,185,129,0.4)",
                                        color: "#10b981",
                                        background: "rgba(16,185,129,0.08)",
                                      }}
                                      disabled={votePendingId === d.id}
                                      onClick={() => castJuryVote(d.id, "reporter")}
                                    >
                                      Uphold
                                    </button>
                                    <button
                                      style={{
                                        ...voteButtonStyle,
                                        borderColor: "rgba(239,68,68,0.4)",
                                        color: "#ef4444",
                                        background: "rgba(239,68,68,0.08)",
                                      }}
                                      disabled={votePendingId === d.id}
                                      onClick={() => castJuryVote(d.id, "creator")}
                                    >
                                      Reject
                                    </button>
                                  </div>
                                ) : (
                                  <span style={{
                                    fontSize: "11px",
                                    padding: "2px 8px",
                                    borderRadius: "4px",
                                    background: assignment.vote ? "rgba(16,185,129,0.08)" : "rgba(255,255,255,0.04)",
                                    color: assignment.vote ? "#10b981" : "rgba(255,255,255,0.4)",
                                  }}>
                                    {assignment.vote ? "Recorded" : "Pending"}
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}

                {/* Parties */}
                <div style={partiesStyle}>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <IconUser />
                    <span style={partyLabelStyle}>Reporter</span>
                    <span style={addressStyle}>{d.reporterAddr.slice(0, 6)}...{d.reporterAddr.slice(-4)}</span>
                    <button onClick={() => copyToClipboard(d.reporterAddr, `reporter-${d.id}`)} style={copyBtnStyle} title="Copy address">
                      {copiedId === `reporter-${d.id}` ? <IconCheck /> : <IconCopy />}
                    </button>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <IconUser />
                    <span style={partyLabelStyle}>Creator</span>
                    <span style={addressStyle}>{d.creatorAddr.slice(0, 6)}...{d.creatorAddr.slice(-4)}</span>
                    <button onClick={() => copyToClipboard(d.creatorAddr, `creator-${d.id}`)} style={copyBtnStyle} title="Copy address">
                      {copiedId === `creator-${d.id}` ? <IconCheck /> : <IconCopy />}
                    </button>
                  </div>
                </div>

                {/* Appeal button */}
                {d.status.toLowerCase() === "resolved" && d.outcome && d.outcome !== "inconclusive" && (
                  <div style={appealSectionStyle}>
                    <button
                      style={appealBtnStyle}
                      onClick={() => window.alert("Appeal requires submitting a 2x counter-stake via the smart contract. Use the Contract UI or CLI.")}
                    >
                      Appeal Decision
                    </button>
                    <span style={{ fontSize: "11px", opacity: 0.4 }}>Requires 2x stake</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */

const containerStyle: React.CSSProperties = {
  maxWidth: "820px",
  margin: "0 auto",
  padding: "20px",
  paddingBottom: "80px",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  paddingBottom: "20px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  marginBottom: "24px",
  gap: "16px",
  flexWrap: "wrap",
};

const repBadgeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "16px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "16px",
  padding: "14px 20px",
  textDecoration: "none",
  color: "inherit",
};

const tabBarStyle: React.CSSProperties = {
  display: "flex",
  gap: "4px",
  marginBottom: "24px",
  background: "rgba(255,255,255,0.02)",
  borderRadius: "14px",
  padding: "4px",
  border: "1px solid rgba(255,255,255,0.06)",
};

const tabStyle: React.CSSProperties = {
  flex: 1,
  background: "none",
  border: "none",
  borderRadius: "10px",
  padding: "12px 14px",
  color: "rgba(255,255,255,0.45)",
  fontSize: "13px",
  fontWeight: 500,
  cursor: "pointer",
  transition: "all 0.2s",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: "8px",
};

const activeTabStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.08)",
  color: "#fff",
  boxShadow: "0 1px 4px rgba(0,0,0,0.2)",
  borderBottom: "2px solid #7c5cff",
};

const countBadgeStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: "20px",
  height: "20px",
  borderRadius: "10px",
  fontSize: "11px",
  fontWeight: 600,
  padding: "0 6px",
};

const contextBannerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "16px",
  padding: "10px 14px",
  marginBottom: "16px",
  borderRadius: "12px",
  background: "rgba(167, 139, 250, 0.1)",
  border: "1px solid rgba(167, 139, 250, 0.22)",
  color: "rgba(255,255,255,0.92)",
  fontSize: "12px",
};

const cardStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.025)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderLeft: "3px solid transparent",
  borderRadius: "14px",
  padding: "20px",
  transition: "border-color 0.2s ease, box-shadow 0.2s ease, background 0.2s ease",
};

const highlightedCardStyle: React.CSSProperties = {
  borderColor: "rgba(167, 139, 250, 0.65)",
  borderLeftColor: "rgba(167, 139, 250, 0.65)",
  background: "rgba(167, 139, 250, 0.06)",
  boxShadow: "0 0 0 1px rgba(167, 139, 250, 0.16), 0 18px 40px rgba(15, 10, 25, 0.3)",
};

const cardHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "flex-start",
  gap: "12px",
};

const statusBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  border: "1px solid",
  borderRadius: "6px",
  padding: "2px 8px",
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
};

const focusedBadgeStyle: React.CSSProperties = {
  display: "inline-block",
  padding: "2px 8px",
  borderRadius: "999px",
  fontSize: "10px",
  fontWeight: 700,
  color: "#c4b5fd",
  background: "rgba(167, 139, 250, 0.16)",
  border: "1px solid rgba(167, 139, 250, 0.24)",
};

const copyBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  cursor: "pointer",
  padding: "2px",
  color: "rgba(255,255,255,0.3)",
  display: "inline-flex",
  alignItems: "center",
  borderRadius: "4px",
  transition: "color 0.15s",
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

const sectionContainerStyle: React.CSSProperties = {
  marginTop: "12px",
  borderRadius: "10px",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.05)",
  overflow: "hidden",
};

const sectionToggleStyle: React.CSSProperties = {
  width: "100%",
  background: "none",
  border: "none",
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "10px 14px",
  color: "rgba(255,255,255,0.7)",
  cursor: "pointer",
  transition: "background 0.15s",
};

const partiesStyle: React.CSSProperties = {
  display: "flex",
  gap: "24px",
  marginTop: "14px",
  fontSize: "12px",
  color: "rgba(255,255,255,0.6)",
  flexWrap: "wrap",
};

const partyLabelStyle: React.CSSProperties = {
  opacity: 0.5,
  fontSize: "11px",
  textTransform: "uppercase",
  letterSpacing: "0.3px",
};

const addressStyle: React.CSSProperties = {
  fontFamily: "monospace",
  fontSize: "11px",
  opacity: 0.7,
};

const juryRowStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  gap: "12px",
  padding: "8px 10px",
  borderRadius: "8px",
  background: "rgba(255,255,255,0.03)",
};

const voteButtonStyle: React.CSSProperties = {
  border: "1px solid",
  borderRadius: "8px",
  padding: "8px 14px",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s",
};

const appealSectionStyle: React.CSSProperties = {
  marginTop: "14px",
  padding: "12px 16px",
  borderRadius: "10px",
  background: "rgba(249,115,22,0.06)",
  border: "1px solid rgba(249,115,22,0.15)",
  display: "flex",
  alignItems: "center",
  gap: "12px",
};

const appealBtnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, rgba(249,115,22,0.15), rgba(249,115,22,0.08))",
  border: "1px solid rgba(249,115,22,0.3)",
  borderRadius: "8px",
  padding: "8px 16px",
  color: "#f97316",
  fontSize: "12px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.2s",
};
