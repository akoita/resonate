"use client";

import { useCallback, useEffect, useState, type CSSProperties } from "react";
import Link from "next/link";
import { useParams, useSearchParams } from "next/navigation";
import { useAuth } from "../../../components/auth/AuthProvider";
import HumanVerificationCard from "../../../components/disputes/HumanVerificationCard";
import { getCuratorProfile, type CuratorProfile } from "../../../lib/api";

export default function CuratorProfilePage() {
  const params = useParams<{ address: string }>();
  const searchParams = useSearchParams();
  const { address: connectedAddress } = useAuth();
  const walletAddress = String(params.address || "").toLowerCase();
  const [profile, setProfile] = useState<CuratorProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const showVerify = searchParams.get("verify") === "1";
  const isOwner = connectedAddress?.toLowerCase() === walletAddress;

  const loadProfile = useCallback(async () => {
    try {
      setLoading(true);
      const next = await getCuratorProfile(walletAddress);
      setProfile(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load curator profile.");
    } finally {
      setLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    void loadProfile();
  }, [loadProfile]);

  if (loading) {
    return <div style={{ padding: "48px 24px", textAlign: "center", opacity: 0.65 }}>Loading curator profile...</div>;
  }

  if (!profile) {
    return <div style={{ padding: "48px 24px", textAlign: "center", opacity: 0.65 }}>{error || "Curator profile unavailable."}</div>;
  }

  return (
    <div style={{ maxWidth: "1100px", margin: "0 auto", padding: "32px 20px 64px" }}>
      <div style={{ marginBottom: "28px" }}>
        <div style={{ fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.55 }}>Curator Reputation</div>
        <h1 style={{ margin: "8px 0 10px", fontSize: "36px" }}>Curator Profile</h1>
        <p style={{ margin: 0, opacity: 0.72, maxWidth: "760px", lineHeight: 1.6 }}>
          Reporting reputation, counter-stake tier, proof-of-humanity state, and dispute quality signals for {walletAddress}.
        </p>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: "14px", marginBottom: "24px" }}>
        <StatCard label="Raw Score" value={String(profile.score)} accent={profile.score >= 0 ? "#10b981" : "#ef4444"} />
        <StatCard label="Effective Score" value={String(profile.effectiveScore)} accent="#60a5fa" />
        <StatCard label="Reports Filed" value={String(profile.reportsFiled)} accent="#f59e0b" />
        <StatCard label="Counter-Stake Tier" value={profile.stakeTier.label} accent="#f472b6" />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.35fr) minmax(320px, 0.85fr)", gap: "20px" }}>
        <div style={{ display: "grid", gap: "20px" }}>
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>Performance</h2>
            <div style={metricRowStyle}>
              <span>Successful Reports</span>
              <strong>{profile.successfulFlags}</strong>
            </div>
            <div style={metricRowStyle}>
              <span>Rejected Reports</span>
              <strong>{profile.rejectedFlags}</strong>
            </div>
            <div style={metricRowStyle}>
              <span>Active Reports</span>
              <strong>{profile.activeReports}</strong>
            </div>
            <div style={metricRowStyle}>
              <span>Claimed Bounties</span>
              <strong>{profile.totalBounties}</strong>
            </div>
            <div style={metricRowStyle}>
              <span>Decay Penalty</span>
              <strong>{profile.decayPenalty}</strong>
            </div>
            <div style={metricRowStyle}>
              <span>Resolution Rate</span>
              <strong>{profile.resolutionRate == null ? "—" : `${Math.round(profile.resolutionRate * 100)}%`}</strong>
            </div>
            <div style={metricRowStyle}>
              <span>Last Active</span>
              <strong>{profile.lastActiveAt ? new Date(profile.lastActiveAt).toLocaleDateString() : "—"}</strong>
            </div>
          </section>

          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>Badges</h2>
            <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
              {profile.badges.map((badge) => (
                <div key={badge.key} style={{
                  padding: "10px 12px",
                  borderRadius: "14px",
                  border: "1px solid rgba(255,255,255,0.1)",
                  background:
                    badge.tone === "success"
                      ? "rgba(16,185,129,0.1)"
                      : badge.tone === "warning"
                        ? "rgba(245,158,11,0.1)"
                        : "rgba(255,255,255,0.04)",
                  minWidth: "180px",
                }}>
                  <div style={{ fontWeight: 600, marginBottom: "4px" }}>{badge.label}</div>
                  <div style={{ fontSize: "12px", opacity: 0.7, lineHeight: 1.45 }}>{badge.description}</div>
                </div>
              ))}
            </div>
          </section>
        </div>

        <div style={{ display: "grid", gap: "20px" }}>
          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>Current Policy</h2>
            <p style={{ marginTop: 0, opacity: 0.78, lineHeight: 1.55 }}>{profile.stakeTier.description}</p>
            <div style={metricRowStyle}>
              <span>Counter-Stake Multiplier</span>
              <strong>{profile.stakeTier.multiplierBps / 100}%</strong>
            </div>
            <div style={metricRowStyle}>
              <span>PoH Requirement</span>
              <strong>{profile.requiresHumanVerification ? "Required now" : "Not required yet"}</strong>
            </div>
          </section>

          {isOwner ? (
            <HumanVerificationCard walletAddress={walletAddress} onVerified={loadProfile} />
          ) : showVerify ? (
            <section style={panelStyle}>
              <h2 style={sectionTitleStyle}>Verification</h2>
              <p style={{ margin: 0, opacity: 0.72, lineHeight: 1.6 }}>
                Connect the matching wallet if you want to manage proof-of-humanity for this curator profile.
              </p>
            </section>
          ) : null}

          <section style={panelStyle}>
            <h2 style={sectionTitleStyle}>Related</h2>
            <div style={{ display: "grid", gap: "10px" }}>
              <Link href="/disputes" style={linkStyle}>Open dispute dashboard</Link>
              {isOwner && <Link href="/artist/onboarding" style={linkStyle}>Return to onboarding</Link>}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={{
      borderRadius: "20px",
      padding: "20px",
      background: "rgba(255,255,255,0.04)",
      border: "1px solid rgba(255,255,255,0.08)",
    }}>
      <div style={{ fontSize: "12px", opacity: 0.6, textTransform: "uppercase", letterSpacing: "0.08em" }}>{label}</div>
      <div style={{ fontSize: "28px", fontWeight: 700, marginTop: "8px", color: accent }}>{value}</div>
    </div>
  );
}

const panelStyle: CSSProperties = {
  borderRadius: "22px",
  padding: "22px",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(8,12,24,0.68)",
};

const sectionTitleStyle: CSSProperties = {
  marginTop: 0,
  marginBottom: "16px",
  fontSize: "20px",
};

const metricRowStyle: CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  gap: "16px",
  padding: "10px 0",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const linkStyle: CSSProperties = {
  color: "#93c5fd",
  textDecoration: "none",
};
