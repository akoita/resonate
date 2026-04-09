"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { getHumanVerificationStatus, submitHumanVerification, type HumanVerificationStatus } from "../../lib/api";

type Props = {
  walletAddress: string;
  onVerified?: () => void;
  compact?: boolean;
};

type VerificationProvider = NonNullable<HumanVerificationStatus["defaultProvider"]>;

const DEFAULT_MOCK_PROOF = "resonate-human";

const DEFAULT_STATUS: HumanVerificationStatus = {
  verified: false,
  provider: null,
  status: "unverified",
  score: null,
  threshold: null,
  verifiedAt: null,
  expiresAt: null,
  requiredAfterReports: 3,
  availableProviders: ["mock", "passport", "worldcoin"],
  defaultProvider: "mock",
};

/* ── Inline SVG Icons ──────────────────────────────────────────── */

function IconShieldCheck({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <polyline points="9 12 11 14 15 10" />
    </svg>
  );
}

function IconAlertTriangle({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  );
}

function IconGlobe({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="2" y1="12" x2="22" y2="12" />
      <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
    </svg>
  );
}

function IconFingerprint({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
      <path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2" />
      <path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <path d="M2 16h.01" />
      <path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <path d="M9 6.8a6 6 0 0 1 9 5.2c0 .47 0 1.17-.02 2" />
    </svg>
  );
}

function IconFlask({ size = 20 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 2v7.527a2 2 0 0 1-.211.896L4.72 20.55a1 1 0 0 0 .9 1.45h12.76a1 1 0 0 0 .9-1.45l-5.069-10.127A2 2 0 0 1 14 9.527V2" />
      <path d="M8.5 2h7" />
      <path d="M7 16h10" />
    </svg>
  );
}

function IconRefresh({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}

function IconAlertCircle({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="8" x2="12" y2="12" />
      <line x1="12" y1="16" x2="12.01" y2="16" />
    </svg>
  );
}

/* ── Provider card configs ─────────────────────────────────────── */

const PROVIDERS = [
  {
    id: "passport",
    label: "Gitcoin Passport",
    description: "Score-based verification",
    icon: IconFingerprint,
  },
  {
    id: "worldcoin",
    label: "World ID",
    description: "Biometric proof",
    icon: IconGlobe,
  },
  {
    id: "mock",
    label: "Mock",
    description: "Dev environments only",
    icon: IconFlask,
  },
] as const;

export default function HumanVerificationCard({ walletAddress, onVerified, compact = false }: Props) {
  const [status, setStatus] = useState<HumanVerificationStatus>(DEFAULT_STATUS);
  const [provider, setProvider] = useState<VerificationProvider>(DEFAULT_STATUS.defaultProvider ?? "mock");
  const [proof, setProof] = useState("");
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        setLoading(true);
        const next = await getHumanVerificationStatus(walletAddress);
        if (!cancelled) {
          setStatus(next);
          const availableProviders: VerificationProvider[] = next.availableProviders?.length
            ? next.availableProviders
            : PROVIDERS.map((item) => item.id);
          const preferredProvider: VerificationProvider = next.provider && availableProviders.includes(next.provider as VerificationProvider)
            ? (next.provider as VerificationProvider)
            : next.defaultProvider && availableProviders.includes(next.defaultProvider)
              ? next.defaultProvider
              : (availableProviders[0] ?? "mock");

          setProvider(preferredProvider);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load verification status.");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
    };
  }, [walletAddress]);

  useEffect(() => {
    if (provider === "mock" && !proof.trim()) {
      setProof(DEFAULT_MOCK_PROOF);
    }
  }, [proof, provider]);

  const hint = useMemo(() => {
    if (provider === "passport") {
      return "Gitcoin Passport checks the connected wallet score on the backend. No pasted proof is required.";
    }
    if (provider === "worldcoin") {
      return "Paste the World ID proof JSON payload from your verification client.";
    }
    return `Use the local mock token for development environments. Default: ${DEFAULT_MOCK_PROOF}.`;
  }, [provider]);

  const availableProviders: VerificationProvider[] = status.availableProviders?.length
    ? status.availableProviders
    : PROVIDERS.map((item) => item.id);
  const providerAvailable = availableProviders.includes(provider);

  const handleVerify = async () => {
    if (!providerAvailable) {
      setError(`${PROVIDERS.find((item) => item.id === provider)?.label ?? "This provider"} is not configured in this environment.`);
      return;
    }

    setSubmitting(true);
    setError(null);
    try {
      const profile = await submitHumanVerification(walletAddress, {
        provider,
        proof: provider === "passport" ? undefined : provider === "mock" ? (proof.trim() || DEFAULT_MOCK_PROOF) : proof,
      });
      setStatus((current) => ({
        ...current,
        ...profile.humanVerification,
      }));
      onVerified?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={cardStyle}>
      {/* Injected keyframes */}
      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>

      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", marginBottom: "20px" }}>
        <div>
          <div style={{ fontSize: "10px", letterSpacing: "0.1em", textTransform: "uppercase", color: "rgba(255,255,255,0.35)", fontWeight: 600 }}>
            Proof of Humanity
          </div>
          <h3 style={{ margin: "8px 0 10px", fontSize: compact ? "18px" : "22px", fontWeight: 700 }}>Verification Status</h3>
          <p style={{ margin: 0, opacity: 0.55, lineHeight: 1.6, fontSize: "13px" }}>
            Curators with {status.requiredAfterReports} or more reports need proof-of-humanity before they can keep filing disputes.
          </p>
        </div>

        {/* Status badge */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          padding: "8px 14px",
          borderRadius: "999px",
          border: `1px solid ${status.verified ? "rgba(16,185,129,0.35)" : "rgba(245,158,11,0.3)"}`,
          background: status.verified ? "rgba(16,185,129,0.06)" : "rgba(245,158,11,0.06)",
          color: status.verified ? "#10b981" : "#f59e0b",
          fontWeight: 600,
          fontSize: "12px",
          whiteSpace: "nowrap",
          boxShadow: status.verified ? "0 0 12px rgba(16,185,129,0.12)" : "0 0 12px rgba(245,158,11,0.08)",
        }}>
          {loading ? (
            <div style={{ animation: "spin 0.8s linear infinite", display: "flex" }}>
              <IconRefresh size={14} />
            </div>
          ) : status.verified ? (
            <IconShieldCheck size={14} />
          ) : (
            <IconAlertTriangle size={14} />
          )}
          {loading ? "Loading..." : status.verified ? "Verified" : "Unverified"}
        </div>
      </div>

      <div style={{ display: "grid", gap: "16px" }}>
        {/* Provider selection cards */}
        <div>
          <span style={labelStyle}>Provider</span>
          <div style={providerGridStyle}>
            {PROVIDERS.map((p) => {
              const isSelected = provider === p.id;
              const isAvailable = availableProviders.includes(p.id);
              const Icon = p.icon;
              return (
                <button
                  key={p.id}
                  onClick={() => {
                    if (isAvailable) {
                      setProvider(p.id);
                      setError(null);
                    }
                  }}
                  disabled={!isAvailable}
                  style={{
                    ...providerCardStyle,
                    borderColor: isSelected ? "rgba(124,92,255,0.4)" : "rgba(255,255,255,0.08)",
                    background: isSelected ? "rgba(124,92,255,0.08)" : "rgba(255,255,255,0.02)",
                    opacity: isAvailable ? 1 : 0.45,
                    cursor: isAvailable ? "pointer" : "not-allowed",
                  }}
                >
                  <div style={{ color: isSelected ? "#a78bfa" : "rgba(255,255,255,0.3)", marginBottom: "6px" }}>
                    <Icon />
                  </div>
                  <div style={{
                    fontSize: "12px",
                    fontWeight: 600,
                    color: isSelected ? "#fff" : "rgba(255,255,255,0.6)",
                  }}>
                    {p.label}
                  </div>
                  <div style={{
                    fontSize: "10px",
                    color: "rgba(255,255,255,0.3)",
                    marginTop: "2px",
                  }}>
                    {isAvailable ? p.description : "Unavailable here"}
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* Proof input */}
        {provider !== "passport" && (
          <div>
            <span style={labelStyle}>
              {provider === "worldcoin" ? "Proof JSON" : "Mock token"}
            </span>
            {provider === "worldcoin" ? (
              <textarea
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                placeholder='{"proof":"...","merkle_root":"...","nullifier_hash":"..."}'
                style={textareaStyle}
              />
            ) : (
              <Input
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                placeholder={DEFAULT_MOCK_PROOF}
              />
            )}
          </div>
        )}

        <p style={{ margin: 0, opacity: 0.4, fontSize: "12px", lineHeight: 1.5 }}>{hint}</p>

        {/* Stats grid */}
        {(status.score != null || status.threshold != null || status.verifiedAt) && (
          <div style={statsGridStyle}>
            {status.score != null && (
              <div style={statCardStyle}>
                <span style={statLabelStyle}>Score</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#10b981" }}>{status.score}</span>
              </div>
            )}
            {status.threshold != null && (
              <div style={statCardStyle}>
                <span style={statLabelStyle}>Threshold</span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "rgba(255,255,255,0.7)" }}>{status.threshold}</span>
              </div>
            )}
            {status.verifiedAt && (
              <div style={statCardStyle}>
                <span style={statLabelStyle}>Verified</span>
                <span style={{ fontSize: "13px", fontWeight: 600, color: "#60a5fa" }}>
                  {new Date(status.verifiedAt).toLocaleDateString()}
                </span>
              </div>
            )}
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={errorStyle}>
            <div style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }}>
              <IconAlertCircle size={16} />
            </div>
            <span>{error}</span>
          </div>
        )}

        <Button type="button" onClick={handleVerify} disabled={submitting || loading || !providerAvailable} variant="primary">
          {submitting ? "Verifying..." : status.verified ? (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <IconRefresh size={14} /> Refresh Verification
            </span>
          ) : (
            <span style={{ display: "inline-flex", alignItems: "center", gap: "6px" }}>
              <IconShieldCheck size={14} /> Verify Humanity
            </span>
          )}
        </Button>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */

const cardStyle: React.CSSProperties = {
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "18px",
  background: "rgba(255,255,255,0.025)",
  padding: "24px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "rgba(255,255,255,0.35)",
  marginBottom: "8px",
};

const providerGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(3, 1fr)",
  gap: "10px",
};

const providerCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  alignItems: "center",
  padding: "16px 12px",
  borderRadius: "12px",
  border: "1px solid",
  cursor: "pointer",
  transition: "all 0.15s",
  textAlign: "center",
  background: "none",
  color: "inherit",
};

const textareaStyle: React.CSSProperties = {
  width: "100%",
  minHeight: "120px",
  borderRadius: "12px",
  background: "rgba(8,12,24,0.72)",
  color: "white",
  border: "1px solid rgba(255,255,255,0.08)",
  padding: "12px 14px",
  resize: "vertical",
  fontSize: "13px",
  boxSizing: "border-box",
  outline: "none",
  transition: "border-color 0.15s",
};

const statsGridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(100px, 1fr))",
  gap: "10px",
};

const statCardStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "4px",
  padding: "12px 14px",
  borderRadius: "10px",
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.05)",
};

const statLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "rgba(255,255,255,0.3)",
};

const errorStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  borderRadius: "12px",
  background: "rgba(239,68,68,0.08)",
  border: "1px solid rgba(239,68,68,0.18)",
  borderLeft: "3px solid rgba(239,68,68,0.4)",
  padding: "12px 14px",
  color: "#fca5a5",
  fontSize: "13px",
};
