"use client";

import { useState, useEffect, useCallback } from "react";

interface Curator {
  walletAddress: string;
  score: number;
  successfulFlags: number;
  rejectedFlags: number;
  totalBounties: number;
}

/* ── Inline SVG Icons ──────────────────────────────────────────── */

function IconTrophy({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
      <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
      <path d="M4 22h16" />
      <path d="M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 20 7 22" />
      <path d="M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 20 17 22" />
      <path d="M18 2H6v7a6 6 0 0 0 12 0V2Z" />
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

/* ── Medal config ──────────────────────────────────────────────── */

const MEDAL_CONFIG = [
  { emoji: "\ud83e\udd47", color: "#fbbf24", bgColor: "rgba(251,191,36,0.08)", borderColor: "rgba(251,191,36,0.25)" },
  { emoji: "\ud83e\udd48", color: "#94a3b8", bgColor: "rgba(148,163,178,0.08)", borderColor: "rgba(148,163,178,0.25)" },
  { emoji: "\ud83e\udd49", color: "#d97706", bgColor: "rgba(217,119,6,0.08)", borderColor: "rgba(217,119,6,0.25)" },
];

export default function CuratorLeaderboard() {
  const [curators, setCurators] = useState<Curator[]>([]);
  const [loading, setLoading] = useState(true);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);

  const copyAddress = (addr: string) => {
    navigator.clipboard.writeText(addr).then(() => {
      setCopiedAddr(addr);
      setTimeout(() => setCopiedAddr(null), 2000);
    });
  };

  const fetchLeaderboard = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/metadata/curators/leaderboard?limit=50");
      if (res.ok) setCurators(await res.json());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchLeaderboard();
  }, [fetchLeaderboard]);

  const topThree = curators.slice(0, 3);
  const rest = curators.slice(3);
  const maxScore = curators.length > 0 ? Math.max(1, ...curators.map((c) => Math.abs(c.score))) : 1;

  if (loading) {
    return (
      <div style={containerStyle}>
        <style>{`
          @keyframes lb-shimmer { 0% { opacity:0.5 } 50% { opacity:1 } 100% { opacity:0.5 } }
        `}</style>
        <div style={{ display: "flex", justifyContent: "center", gap: "16px", marginTop: "60px" }}>
          {[1, 2, 3].map((i) => (
            <div key={i} style={{ width: "160px", height: "140px", borderRadius: "16px", background: "rgba(255,255,255,0.03)", animation: "lb-shimmer 1.5s infinite" }} />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div style={containerStyle}>
      {/* Header */}
      <div style={headerStyle}>
        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "6px" }}>
            <div style={{ color: "#fbbf24" }}><IconTrophy /></div>
            <h1 style={{ margin: 0, fontSize: "28px", fontWeight: 700, letterSpacing: "-0.5px" }}>
              Curator Leaderboard
            </h1>
            {curators.length > 0 && (
              <span style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 10px",
                borderRadius: "999px",
                background: "rgba(255,255,255,0.06)",
                fontSize: "12px",
                fontWeight: 600,
                color: "rgba(255,255,255,0.5)",
              }}>
                {curators.length} curators
              </span>
            )}
          </div>
          <p style={{ margin: 0, fontSize: "13px", color: "rgba(255,255,255,0.4)" }}>
            Top curators protecting the platform from stolen content
          </p>
        </div>
      </div>

      {curators.length === 0 ? (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", padding: "80px 20px", gap: "16px" }}>
          <div style={{
            width: "72px",
            height: "72px",
            borderRadius: "18px",
            background: "rgba(251,191,36,0.06)",
            border: "1px solid rgba(251,191,36,0.12)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "rgba(251,191,36,0.3)",
          }}>
            <IconTrophy size={36} />
          </div>
          <div style={{ fontSize: "16px", fontWeight: 600, color: "rgba(255,255,255,0.5)" }}>No curators yet</div>
          <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.3)" }}>Be the first to flag stolen content and earn your place here</div>
        </div>
      ) : (
        <>
          {/* Podium - Top 3 */}
          {topThree.length > 0 && (
            <div style={podiumContainerStyle}>
              {/* Visual order: 2nd, 1st, 3rd */}
              {[1, 0, 2].map((rank) => {
                const curator = topThree[rank];
                if (!curator) return null;
                const medal = MEDAL_CONFIG[rank];
                const isFirst = rank === 0;

                return (
                  <div
                    key={curator.walletAddress}
                    style={{
                      ...podiumCardStyle,
                      background: medal.bgColor,
                      borderColor: medal.borderColor,
                      paddingTop: isFirst ? "32px" : rank === 1 ? "24px" : "20px",
                      minHeight: isFirst ? "180px" : "160px",
                      alignSelf: "flex-end",
                    }}
                  >
                    <div style={{ fontSize: isFirst ? "36px" : "28px", lineHeight: 1 }}>{medal.emoji}</div>
                    <div style={{
                      fontSize: isFirst ? "28px" : "22px",
                      fontWeight: 800,
                      color: curator.score > 0 ? "#10b981" : curator.score < 0 ? "#ef4444" : "#6b7280",
                      marginTop: "8px",
                    }}>
                      {curator.score}
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "8px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "12px", opacity: 0.6 }}>
                        {curator.walletAddress.slice(0, 6)}...{curator.walletAddress.slice(-4)}
                      </span>
                      <button onClick={() => copyAddress(curator.walletAddress)} style={copyBtnStyle} title="Copy address">
                        {copiedAddr === curator.walletAddress ? <IconCheck /> : <IconCopy />}
                      </button>
                    </div>
                    <div style={{ display: "flex", gap: "12px", marginTop: "10px", fontSize: "11px" }}>
                      <span style={{ color: "#10b981" }}>{curator.successfulFlags} upheld</span>
                      <span style={{ color: "#ef4444" }}>{curator.rejectedFlags} rejected</span>
                    </div>
                    {curator.totalBounties > 0 && (
                      <div style={{ fontSize: "11px", color: medal.color, marginTop: "4px", fontWeight: 600 }}>
                        {curator.totalBounties} bounties
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* List - Rank 4+ */}
          {rest.length > 0 && (
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", marginTop: "24px" }}>
              {rest.map((c, i) => {
                const rank = i + 4;
                const barWidth = Math.min(100, (Math.abs(c.score) / maxScore) * 100);
                const barColor = c.score > 0 ? "rgba(16,185,129,0.15)" : c.score < 0 ? "rgba(239,68,68,0.15)" : "rgba(255,255,255,0.04)";

                return (
                  <div key={c.walletAddress} style={rowStyle}>
                    <div style={rankStyle}>#{rank}</div>

                    <div style={{ flex: 1, display: "flex", alignItems: "center", gap: "6px" }}>
                      <span style={{ fontFamily: "monospace", fontSize: "13px", opacity: 0.7 }}>
                        {c.walletAddress.slice(0, 6)}...{c.walletAddress.slice(-4)}
                      </span>
                      <button onClick={() => copyAddress(c.walletAddress)} style={copyBtnStyle} title="Copy address">
                        {copiedAddr === c.walletAddress ? <IconCheck /> : <IconCopy />}
                      </button>
                    </div>

                    {/* Score with bar */}
                    <div style={{ position: "relative", minWidth: "80px" }}>
                      <div style={{
                        position: "absolute",
                        left: 0,
                        top: 0,
                        bottom: 0,
                        width: `${barWidth}%`,
                        background: barColor,
                        borderRadius: "6px",
                        transition: "width 0.3s",
                      }} />
                      <div style={{ position: "relative", padding: "4px 8px", textAlign: "right" }}>
                        <span style={{
                          fontWeight: 700,
                          fontSize: "13px",
                          color: c.score > 0 ? "#10b981" : c.score < 0 ? "#ef4444" : "#6b7280",
                        }}>
                          {c.score}
                        </span>
                      </div>
                    </div>

                    <div style={{ display: "flex", gap: "12px", alignItems: "center", fontSize: "12px", minWidth: "140px", justifyContent: "flex-end" }}>
                      <span style={{ color: "rgba(16,185,129,0.7)" }}>{c.successfulFlags} upheld</span>
                      <span style={{ color: "rgba(239,68,68,0.7)" }}>{c.rejectedFlags} rejected</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
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
  paddingBottom: "20px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
  marginBottom: "28px",
};

const podiumContainerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "center",
  alignItems: "flex-end",
  gap: "14px",
};

const podiumCardStyle: React.CSSProperties = {
  flex: 1,
  maxWidth: "220px",
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "20px 16px",
  borderRadius: "16px",
  border: "1px solid",
  textAlign: "center",
  transition: "all 0.2s",
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
};

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "10px 16px",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.05)",
  borderRadius: "10px",
  transition: "background 0.15s",
};

const rankStyle: React.CSSProperties = {
  width: "36px",
  textAlign: "center",
  fontSize: "13px",
  fontWeight: 700,
  color: "rgba(255,255,255,0.35)",
};
