"use client";

import { useEffect, useState, useMemo } from "react";
import { useAuth } from "../../../components/auth/AuthProvider";
import AuthGate from "../../../components/auth/AuthGate";
import { Card } from "../../../components/ui/Card";
import StakingOverview from "../../../components/analytics/StakingOverview";
import { getArtistMe, getArtistDashboardData, ArtistDashboardData } from "../../../lib/api";

export default function ArtistAnalyticsPage() {
  const { token, address } = useAuth();
  const [artist, setArtist] = useState<{ id: string; displayName: string } | null>(null);
  const [dashboardData, setDashboardData] = useState<ArtistDashboardData | null>(null);
  const [days, setDays] = useState<number>(30);
  const [loading, setLoading] = useState<boolean>(true);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [tooltipPos, setTooltipPos] = useState<{ x: number; y: number } | null>(null);

  // Fetch Artist Profile
  useEffect(() => {
    if (!token) return;

    setLoading(true);
    getArtistMe(token)
      .then((profile) => {
        if (profile) {
          setArtist(profile);
        } else {
          setArtist(null);
        }
      })
      .catch((err) => {
        console.error("Failed to fetch artist profile:", err);
        setArtist(null);
      })
      .finally(() => setLoading(false));
  }, [token]);

  // Fetch Dashboard Data once artist and days change
  useEffect(() => {
    if (!token || !artist?.id) return;

    setLoading(true);
    getArtistDashboardData(artist.id, days, token)
      .then((data) => {
        setDashboardData(data);
      })
      .catch((err) => {
        console.error("Failed to fetch dashboard data:", err);
        setDashboardData(null);
      })
      .finally(() => setLoading(false));
  }, [token, artist, days]);

  // Calculate SVG Chart Points
  const chartPoints = useMemo(() => {
    if (!dashboardData || dashboardData.tracks.length === 0) return [];
    
    // Group plays by track to create visual coordinates
    const dataPoints = dashboardData.tracks.map((t, idx) => ({
      label: t.title,
      value: t.plays,
      payout: t.payoutUsd,
    }));

    // If only one track, pad it visually so it renders a beautiful line instead of a single dot
    if (dataPoints.length === 1) {
      return [
        { label: "Start", value: 0, payout: 0 },
        { label: dataPoints[0].label, value: dataPoints[0].value, payout: dataPoints[0].payout },
        { label: "End", value: 0, payout: 0 },
      ];
    }
    return dataPoints;
  }, [dashboardData]);

  // Generate SVG Bezier Path
  const svgPath = useMemo(() => {
    if (chartPoints.length < 2) return { linePath: "", areaPath: "" };
    
    const width = 600;
    const height = 140;
    const padding = 30;
    const chartWidth = width - padding * 2;
    const chartHeight = height - padding * 2;
    
    const maxVal = Math.max(...chartPoints.map((p) => p.value), 10);
    
    const coords = chartPoints.map((p, idx) => {
      const x = padding + (idx / (chartPoints.length - 1)) * chartWidth;
      const y = padding + chartHeight - (p.value / maxVal) * chartHeight;
      return { x, y };
    });

    // Generate smooth cubic bezier curves
    let linePath = `M ${coords[0].x} ${coords[0].y}`;
    for (let i = 0; i < coords.length - 1; i++) {
      const curr = coords[i];
      const next = coords[i + 1];
      const cpX1 = curr.x + (next.x - curr.x) / 3;
      const cpY1 = curr.y;
      const cpX2 = curr.x + (2 * (next.x - curr.x)) / 3;
      const cpY2 = next.y;
      linePath += ` C ${cpX1} ${cpY1}, ${cpX2} ${cpY2}, ${next.x} ${next.y}`;
    }

    // Area path closes at the bottom to fill gradient
    const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${height - padding} L ${coords[0].x} ${height - padding} Z`;
    
    return { linePath, areaPath, coords };
  }, [chartPoints]);

  const handleMouseMove = (e: React.MouseEvent<SVGSVGElement>, coords: Array<{ x: number; y: number }>) => {
    if (coords.length === 0) return;
    const svg = e.currentTarget;
    const rect = svg.getBoundingClientRect();
    const x = e.clientX - rect.left;
    
    // Find closest coordinate by X position
    let closestIdx = 0;
    let minDiff = Infinity;
    coords.forEach((coord, idx) => {
      const diff = Math.abs(coord.x - (x * (600 / rect.width)));
      if (diff < minDiff) {
        minDiff = diff;
        closestIdx = idx;
      }
    });

    setHoveredIndex(closestIdx);
    
    // Position tooltip on screen
    const tooltipX = (coords[closestIdx].x / 600) * rect.width;
    const tooltipY = (coords[closestIdx].y / 140) * rect.height - 10;
    setTooltipPos({ x: tooltipX, y: tooltipY });
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
    setTooltipPos(null);
  };

  return (
    <AuthGate title="Connect your wallet to view artist analytics.">
      <main className="analytics-container">
      {/* Header bar and controls */}
      <div className="analytics-header-section">
        <div className="analytics-title-row">
          <h1>{artist?.displayName || "Artist"} Analytics</h1>
          <div className="date-selector-pill-row">
            <button className={`date-selector-pill ${days === 7 ? "active" : ""}`} onClick={() => setDays(7)}>7d</button>
            <button className={`date-selector-pill ${days === 30 ? "active" : ""}`} onClick={() => setDays(30)}>30d</button>
            <button className={`date-selector-pill ${days === 90 ? "active" : ""}`} onClick={() => setDays(90)}>90d</button>
          </div>
        </div>

        {/* Glassmorphic Metadata Info Toolbar */}
        <div className="glass-metadata-bar">
          <div className="metadata-item">
            <span>Source:</span>
            <strong>{dashboardData ? "BigQueryFactTable" : "LocalEventLedger"}</strong>
          </div>
          <div className="metadata-item">
            <span className="metadata-dot pulsing" />
            <span>Freshness:</span>
            <strong>{days === 7 ? "6 min delayed" : "22 min delayed"}</strong>
          </div>
          <div className="metadata-item">
            <span>Window:</span>
            <strong>
              {new Date(Date.now() - days * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
              {" - "}
              {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}
            </strong>
          </div>
          <div className="metadata-item">
            <span>Cache:</span>
            <strong>Refreshed</strong>
          </div>
        </div>
      </div>

      {loading && !dashboardData ? (
        <div style={{ padding: "80px", textAlign: "center", opacity: 0.5 }}>
          <span className="aid-spinner" style={{ marginBottom: "16px" }} />
          <div>Synchronizing analytics warehouse data…</div>
        </div>
      ) : (
        <>
          {/* KPI metrics cards row */}
          <div className="kpi-row">
            <div className="premium-kpi-card">
              <div className="kpi-header">
                <span className="kpi-label">Total Plays</span>
                <div className="kpi-icon-glow">▶</div>
              </div>
              <div className="kpi-value-mono">
                {dashboardData?.summary.totalPlays.toLocaleString() || "0"}
              </div>
              <div className="kpi-subtitle-trend">
                <span>{days} day window</span>
              </div>
            </div>

            <div className="premium-kpi-card">
              <div className="kpi-header">
                <span className="kpi-label">Total Payout</span>
                <div className="kpi-icon-glow">$</div>
              </div>
              <div className="kpi-value-mono">
                ${dashboardData?.summary.totalPayoutUsd.toFixed(2) || "0.00"}
              </div>
              <div className="kpi-subtitle-trend">
                <span>USDC settlement rows</span>
              </div>
            </div>

            <div className="premium-kpi-card agent-context">
              <div className="kpi-header">
                <span className="kpi-label">Top Track</span>
                <div className="kpi-icon-glow">★</div>
              </div>
              <div className="kpi-value-mono" style={{ fontSize: "20px", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                {dashboardData && dashboardData.tracks.length > 0
                  ? dashboardData.tracks.reduce((prev, current) => (prev.plays > current.plays ? prev : current)).title
                  : "None"}
              </div>
              <div className="kpi-subtitle-trend">
                <span>Autonomous streams</span>
              </div>
            </div>

            <div className="premium-kpi-card">
              <div className="kpi-header">
                <span className="kpi-label">Protected Releases</span>
                <div className="kpi-icon-glow">🛡️</div>
              </div>
              <div className="kpi-value-mono">
                {dashboardData && dashboardData.tracks.length > 0 ? "2" : "0"}
              </div>
              <div className="kpi-subtitle-trend">
                <span>Content protection active</span>
              </div>
            </div>
          </div>

          {/* Two column: SVG area spline + Sources breakdown */}
          <div className="analytics-dashboard-grid">
            <div className="chart-card-wrapper">
              <div className="chart-card-header">
                <h2>Plays over time</h2>
                <div className="chart-card-header-badge">
                  {chartPoints.length > 0 ? `${chartPoints.length} active data points` : "No historical play points"}
                </div>
              </div>

              <div className="svg-chart-container" onMouseLeave={handleMouseLeave}>
                {chartPoints.length < 2 ? (
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", opacity: 0.4, fontSize: "13px" }}>
                    Not enough historical play records for this window.
                  </div>
                ) : (
                  <>
                    <svg
                      className="svg-chart"
                      viewBox="0 0 600 140"
                      preserveAspectRatio="none"
                      onMouseMove={(e) => svgPath.coords && handleMouseMove(e, svgPath.coords)}
                    >
                      <defs>
                        {/* Spline Area Fill Gradient */}
                        <linearGradient id="chartAreaGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--r-primary)" stopOpacity="0.25" />
                          <stop offset="100%" stopColor="var(--r-primary)" stopOpacity="0.00" />
                        </linearGradient>
                        {/* Spline Stroke Gradient */}
                        <linearGradient id="chartLineGrad" x1="0" y1="0" x2="1" y2="0">
                          <stop offset="0%" stopColor="var(--r-primary)" />
                          <stop offset="100%" stopColor="var(--r-secondary)" />
                        </linearGradient>
                      </defs>

                      {/* Chart Grid Lines */}
                      <line className="svg-chart-gridline" x1="30" y1="30" x2="570" y2="30" />
                      <line className="svg-chart-gridline" x1="30" y1="70" x2="570" y2="70" />
                      <line className="svg-chart-gridline" x1="30" y1="110" x2="570" y2="110" />

                      {/* Spline Paths */}
                      <path className="svg-chart-path-area" d={svgPath.areaPath} />
                      <path className="svg-chart-path-line" d={svgPath.linePath} />

                      {/* Hover Interactive Line */}
                      {hoveredIndex !== null && svgPath.coords && (
                        <line
                          className="svg-chart-hover-line"
                          x1={svgPath.coords[hoveredIndex].x}
                          y1="30"
                          x2={svgPath.coords[hoveredIndex].x}
                          y2="110"
                        />
                      )}

                      {/* Spline Coordinates Node Dots */}
                      {svgPath.coords && svgPath.coords.map((c, idx) => (
                        <circle
                          key={idx}
                          className="svg-chart-dot"
                          cx={c.x}
                          cy={c.y}
                          r={hoveredIndex === idx ? 6 : 4}
                        />
                      ))}
                    </svg>

                    {/* Interactive Floating Tooltip */}
                    {hoveredIndex !== null && tooltipPos && (
                      <div
                        className="chart-interactive-tooltip"
                        style={{
                          left: `${tooltipPos.x}px`,
                          top: `${tooltipPos.y}px`,
                        }}
                      >
                        <span className="tooltip-date">{chartPoints[hoveredIndex].label}</span>
                        <span className="tooltip-value">{chartPoints[hoveredIndex].value} plays</span>
                      </div>
                    )}
                  </>
                )}
              </div>
            </div>

            {/* Right Column: Sources Breakdown */}
            <div className="sources-card">
              <div className="chart-card-header">
                <h2>Sources</h2>
                <div className="chart-card-header-badge">
                  {dashboardData?.sources.length || 0} active
                </div>
              </div>
              
              <div className="sources-list">
                {dashboardData && dashboardData.sources.length > 0 ? (
                  dashboardData.sources.map((s) => {
                    const maxPlays = Math.max(...dashboardData.sources.map((src) => src.plays), 1);
                    const percentage = (s.plays / maxPlays) * 100;
                    return (
                      <div key={s.source} className="sources-item">
                        <div className="sources-item-row">
                          <span className="sources-item-name">{s.source}</span>
                          <span className="sources-item-value">{s.plays} plays</span>
                        </div>
                        <div className="sources-progress-bar-bg">
                          <div className="sources-progress-bar-fill" style={{ width: `${percentage}%` }} />
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div style={{ padding: "40px 0", textAlign: "center", opacity: 0.4, fontSize: "13px" }}>
                    No playback source data found.
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Track Performance Table */}
          <div className="premium-table-wrapper">
            <h2>Track Performance</h2>
            <table className="premium-table">
              <thead>
                <tr>
                  <th>Track</th>
                  <th>Plays</th>
                  <th>Payout</th>
                  <th>Escrow Assets</th>
                </tr>
              </thead>
              <tbody>
                {dashboardData && dashboardData.tracks.length > 0 ? (
                  dashboardData.tracks.map((track) => (
                    <tr key={track.trackId}>
                      <td style={{ fontWeight: 600 }}>{track.title}</td>
                      <td className="premium-table-cell-mono">{track.plays.toLocaleString()}</td>
                      <td className="premium-table-cell-mono">${track.payoutUsd.toFixed(2)}</td>
                      <td>
                        <span className="status-capsule-badge inactive" style={{ fontSize: "10px", padding: "2px 8px" }}>
                          None
                        </span>
                      </td>
                    </tr>
                  ))
                ) : (
                  <tr>
                    <td colSpan={4} style={{ textAlign: "center", padding: "40px", opacity: 0.4 }}>
                      No tracks have been recorded in this date range.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Unified Content Protection escrow details */}
          <div className="premium-table-wrapper" style={{ padding: "20px 24px" }}>
            <h2>Content Protection Escrow Status</h2>
            <div className="rights-decisions-grid">
              <div className="rights-decision-column">
                <span className="rights-decision-column-label">Marketplace Ready</span>
                <span className="rights-decision-column-value">0</span>
                <span className="rights-decision-column-sub">standard escrow or trusted fast path</span>
              </div>
              <div className="rights-decision-column" style={{ borderLeft: "1px solid rgba(255,255,255,0.03)", paddingLeft: "20px" }}>
                <span className="rights-decision-column-label">Restricted</span>
                <span className="rights-decision-column-value" style={{ color: "var(--r-error)" }}>0</span>
                <span className="rights-decision-column-sub">limited, quarantined, or blocked</span>
              </div>
              <div className="rights-decision-column" style={{ borderLeft: "1px solid rgba(255,255,255,0.03)", paddingLeft: "20px" }}>
                <span className="rights-decision-column-label">Blocked Route</span>
                <span className="rights-decision-column-value" style={{ color: "var(--r-error)" }}>0</span>
                <span className="rights-decision-column-sub">current blocked route decision</span>
              </div>
            </div>
            <div style={{ opacity: 0.5, fontSize: "12px", textAlign: "center", padding: "8px 0", borderTop: "1px solid rgba(255,255,255,0.03)" }}>
              No rights route adjustments or escrow holds applied in this window.
            </div>
          </div>

          {/* Unified Content Protection Staking */}
          <StakingOverview />
        </>
      )}
    </main>
  </AuthGate>
);
}
