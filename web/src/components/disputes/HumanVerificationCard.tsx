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

const DEFAULT_STATUS: HumanVerificationStatus = {
  verified: false,
  provider: null,
  status: "unverified",
  score: null,
  threshold: null,
  verifiedAt: null,
  expiresAt: null,
  requiredAfterReports: 3,
};

export default function HumanVerificationCard({ walletAddress, onVerified, compact = false }: Props) {
  const [status, setStatus] = useState<HumanVerificationStatus>(DEFAULT_STATUS);
  const [provider, setProvider] = useState("passport");
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
          if (next.provider) {
            setProvider(next.provider);
          }
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

  const hint = useMemo(() => {
    if (provider === "passport") {
      return "Gitcoin Passport checks the connected wallet score on the backend. No pasted proof is required.";
    }
    if (provider === "worldcoin") {
      return "Paste the World ID proof JSON payload from your verification client.";
    }
    return "Use the local mock token for development environments.";
  }, [provider]);

  const handleVerify = async () => {
    setSubmitting(true);
    setError(null);
    try {
      const profile = await submitHumanVerification(walletAddress, {
        provider,
        proof: provider === "passport" ? undefined : proof,
      });
      setStatus(profile.humanVerification);
      onVerified?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Verification failed.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={{
      border: "1px solid rgba(255,255,255,0.1)",
      borderRadius: "18px",
      background: "rgba(255,255,255,0.03)",
      padding: compact ? "18px" : "24px",
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: "16px", alignItems: "flex-start", marginBottom: "16px" }}>
        <div>
          <div style={{ fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase", opacity: 0.6 }}>Proof of Humanity</div>
          <h3 style={{ margin: "6px 0 8px", fontSize: compact ? "18px" : "22px" }}>Verification Status</h3>
          <p style={{ margin: 0, opacity: 0.75, lineHeight: 1.5 }}>
            Curators with {status.requiredAfterReports} or more reports need proof-of-humanity before they can keep filing disputes.
          </p>
        </div>
        <div style={{
          padding: "8px 12px",
          borderRadius: "999px",
          border: `1px solid ${status.verified ? "rgba(16,185,129,0.45)" : "rgba(245,158,11,0.35)"}`,
          color: status.verified ? "#10b981" : "#f59e0b",
          fontWeight: 600,
          fontSize: "12px",
          whiteSpace: "nowrap",
        }}>
          {loading ? "Loading..." : status.verified ? "Verified" : "Unverified"}
        </div>
      </div>

      <div style={{ display: "grid", gap: "14px" }}>
        <label style={{ display: "grid", gap: "6px" }}>
          <span style={{ fontSize: "13px", opacity: 0.75 }}>Provider</span>
          <select
            value={provider}
            onChange={(e) => setProvider(e.target.value)}
            style={{
              borderRadius: "12px",
              background: "rgba(8,12,24,0.72)",
              color: "white",
              border: "1px solid rgba(255,255,255,0.1)",
              padding: "12px 14px",
            }}
          >
            <option value="passport">Gitcoin Passport</option>
            <option value="worldcoin">World ID</option>
            <option value="mock">Mock</option>
          </select>
        </label>

        {provider !== "passport" && (
          <label style={{ display: "grid", gap: "6px" }}>
            <span style={{ fontSize: "13px", opacity: 0.75 }}>
              {provider === "worldcoin" ? "Proof JSON" : "Mock token"}
            </span>
            {provider === "worldcoin" ? (
              <textarea
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                placeholder='{"proof":"...","merkle_root":"...","nullifier_hash":"..."}'
                style={{
                  minHeight: "120px",
                  borderRadius: "12px",
                  background: "rgba(8,12,24,0.72)",
                  color: "white",
                  border: "1px solid rgba(255,255,255,0.1)",
                  padding: "12px 14px",
                  resize: "vertical",
                }}
              />
            ) : (
              <Input
                value={proof}
                onChange={(e) => setProof(e.target.value)}
                placeholder="resonate-human"
              />
            )}
          </label>
        )}

        <p style={{ margin: 0, opacity: 0.6, fontSize: "12px", lineHeight: 1.5 }}>{hint}</p>

        {(status.score != null || status.threshold != null || status.verifiedAt) && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: "12px", fontSize: "13px", opacity: 0.8 }}>
            {status.score != null && <span>Score: {status.score}</span>}
            {status.threshold != null && <span>Threshold: {status.threshold}</span>}
            {status.verifiedAt && <span>Verified: {new Date(status.verifiedAt).toLocaleDateString()}</span>}
          </div>
        )}

        {error && (
          <div style={{
            borderRadius: "12px",
            background: "rgba(239,68,68,0.12)",
            border: "1px solid rgba(239,68,68,0.24)",
            padding: "12px 14px",
            color: "#fca5a5",
            fontSize: "13px",
          }}>
            {error}
          </div>
        )}

        <Button type="button" onClick={handleVerify} disabled={submitting || loading} variant="primary">
          {submitting ? "Verifying..." : status.verified ? "Refresh Verification" : "Verify Humanity"}
        </Button>
      </div>
    </div>
  );
}
