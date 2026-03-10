"use client";

import { useState, useEffect, useCallback } from "react";

interface Curator {
  walletAddress: string;
  score: number;
  successfulFlags: number;
  rejectedFlags: number;
  totalBounties: number;
}

export default function CuratorLeaderboard() {
  const [curators, setCurators] = useState<Curator[]>([]);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return <div style={{ textAlign: "center", padding: "60px", opacity: 0.4 }}>Loading leaderboard...</div>;
  }

  return (
    <div style={{ maxWidth: "800px", margin: "0 auto", padding: "20px" }}>
      <h1 style={{ fontSize: "24px", fontWeight: 700, marginBottom: "8px" }}>🏆 Curator Leaderboard</h1>
      <p style={{ fontSize: "13px", opacity: 0.5, marginBottom: "24px" }}>
        Top curators protecting the platform from stolen content
      </p>

      {curators.length === 0 ? (
        <div style={{ textAlign: "center", padding: "80px 20px", opacity: 0.3, fontSize: "14px" }}>
          No curators yet — be the first to flag stolen content!
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          {curators.map((c, i) => (
            <div key={c.walletAddress} style={rowStyle}>
              {/* Rank */}
              <div style={rankStyle}>
                {i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : `#${i + 1}`}
              </div>

              {/* Address */}
              <div style={{ flex: 1 }}>
                <span style={{ fontFamily: "monospace", fontSize: "13px" }}>
                  {c.walletAddress.slice(0, 6)}...{c.walletAddress.slice(-4)}
                </span>
              </div>

              {/* Stats */}
              <div style={{ display: "flex", gap: "16px", alignItems: "center", fontSize: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ opacity: 0.4 }}>Score</span>
                  <span style={{
                    fontWeight: 700,
                    color: c.score > 0 ? "#10b981" : c.score < 0 ? "#ef4444" : "#6b7280",
                  }}>
                    {c.score}
                  </span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ opacity: 0.4 }}>✅</span>
                  <span>{c.successfulFlags}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ opacity: 0.4 }}>❌</span>
                  <span>{c.rejectedFlags}</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                  <span style={{ opacity: 0.4 }}>💰</span>
                  <span>{c.totalBounties}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

const rowStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "12px",
  padding: "12px 16px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "10px",
};

const rankStyle: React.CSSProperties = {
  width: "36px",
  textAlign: "center",
  fontSize: "16px",
  fontWeight: 700,
};
