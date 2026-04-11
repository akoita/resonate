"use client";

import { useEffect, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useZeroDev } from "../auth/ZeroDevProviderClient";
import { useReportContent } from "../../hooks/useContracts";
import { formatEth } from "../../lib/stakeConstants";
import {
  getCuratorReportingPolicy,
  submitRightsEvidenceBundle,
  type CuratorReportingPolicy,
  type ReleaseContentProtectionData,
  type RightsEvidenceKind,
  type RightsEvidenceStrength,
} from "../../lib/api";

interface ReportContentModalProps {
  releaseId: string;
  onClose: () => void;
  onSubmitted?: (result: { disputeId?: string; txHash: string; tokenId?: string; counterStakeEth: string }) => void;
}

interface ReporterDispute {
  tokenId: string;
}

/* ── Inline SVG Icons ──────────────────────────────────────────── */

function IconFlag({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
      <line x1="4" y1="22" x2="4" y2="15" />
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

function IconAlertTriangle({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
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

function IconDiamond({ size = 14 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3h12l4 6-10 13L2 9z" />
    </svg>
  );
}

const PRIMARY_EVIDENCE_OPTIONS: Array<{
  value: RightsEvidenceKind;
  label: string;
  hint: string;
}> = [
  {
    value: "prior_publication",
    label: "Prior publication",
    hint: "Official release page, streaming link, or canonical publication record.",
  },
  {
    value: "trusted_catalog_reference",
    label: "Trusted catalog reference",
    hint: "Distributor, label, or trusted source catalog evidence.",
  },
  {
    value: "rights_metadata",
    label: "Rights metadata",
    hint: "ISRC, UPC, metadata package, or registry-backed identifiers.",
  },
  {
    value: "proof_of_control",
    label: "Proof of control",
    hint: "Official profile, domain, dashboard, or account-control proof.",
  },
];

const STRENGTH_OPTIONS: Array<{ value: RightsEvidenceStrength; label: string }> = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very High" },
];

/* ── Step Indicator ────────────────────────────────────────────── */

function StepIndicator({ currentPhase }: { currentPhase: number }) {
  const steps = ["Review Info", "Provide Evidence", "Confirm"];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: "0", marginBottom: "24px" }}>
      {steps.map((step, i) => {
        const isDone = i < currentPhase;
        const isCurrent = i === currentPhase;
        const dotColor = isDone ? "#10b981" : isCurrent ? "#ef4444" : "rgba(255,255,255,0.15)";

        return (
          <div key={step} style={{ display: "flex", alignItems: "center", flex: i < steps.length - 1 ? 1 : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: "4px" }}>
              <div style={{
                width: "24px",
                height: "24px",
                borderRadius: "50%",
                background: isDone || isCurrent ? dotColor : "transparent",
                border: isDone || isCurrent ? "none" : "2px solid rgba(255,255,255,0.12)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                fontSize: "11px",
                fontWeight: 700,
                color: isDone || isCurrent ? "#fff" : "rgba(255,255,255,0.3)",
                transition: "all 0.3s",
              }}>
                {isDone ? "\u2713" : i + 1}
              </div>
              <span style={{
                fontSize: "9px",
                fontWeight: isCurrent ? 700 : 500,
                color: isCurrent ? "rgba(255,255,255,0.9)" : isDone ? "rgba(255,255,255,0.5)" : "rgba(255,255,255,0.25)",
                textTransform: "uppercase",
                letterSpacing: "0.3px",
                whiteSpace: "nowrap",
              }}>
                {step}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div style={{
                flex: 1,
                height: "2px",
                background: isDone ? "#10b981" : "rgba(255,255,255,0.08)",
                marginBottom: "18px",
                marginLeft: "6px",
                marginRight: "6px",
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

export default function ReportContentModal({
  releaseId,
  onClose,
  onSubmitted,
}: ReportContentModalProps) {
  const { address, token } = useAuth();
  const { chainId } = useZeroDev();
  const { report, getRequiredCounterStake, pending } = useReportContent();
  const [primaryEvidenceKind, setPrimaryEvidenceKind] = useState<RightsEvidenceKind>("prior_publication");
  const [primaryEvidenceTitle, setPrimaryEvidenceTitle] = useState("");
  const [evidenceURL, setEvidenceURL] = useState("");
  const [claimedRightsholder, setClaimedRightsholder] = useState("");
  const [primaryEvidenceDescription, setPrimaryEvidenceDescription] = useState("");
  const [narrativeSummary, setNarrativeSummary] = useState("");
  const [evidenceStrength, setEvidenceStrength] = useState<RightsEvidenceStrength>("high");
  const [error, setError] = useState<string | null>(null);
  const [protection, setProtection] = useState<ReleaseContentProtectionData | null>(null);
  const [counterStake, setCounterStake] = useState<bigint | null>(null);
  const [reportingPolicy, setReportingPolicy] = useState<CuratorReportingPolicy | null>(null);
  const [alreadyReported, setAlreadyReported] = useState(false);
  const [loadingProtection, setLoadingProtection] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const hasPrimaryEvidence =
    primaryEvidenceTitle.trim() &&
    evidenceURL.trim() &&
    claimedRightsholder.trim();
  const currentPhase = !hasPrimaryEvidence ? 1 : !narrativeSummary.trim() ? 2 : 3;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  useEffect(() => {
    let cancelled = false;

    const loadProtection = async () => {
      try {
        setLoadingProtection(true);
        setAlreadyReported(false);
        const [protectionRes, counterStakeWei, policy, reporterDisputes] = await Promise.all([
          fetch(`/api/metadata/content-protection/release/${releaseId}`),
          getRequiredCounterStake(),
          address ? getCuratorReportingPolicy(address) : Promise.resolve(null),
          address
            ? fetch(`/api/metadata/disputes/reporter/${address.toLowerCase()}`)
                .then(async (response) => (response.ok ? (await response.json()) as ReporterDispute[] : []))
                .catch(() => [] as ReporterDispute[])
            : Promise.resolve([] as ReporterDispute[]),
        ]);

        if (!protectionRes.ok) {
          throw new Error("Could not load the content protection record for this release.");
        }

        const protectionData = (await protectionRes.json()) as ReleaseContentProtectionData;
        const hasExistingReport = Boolean(
          protectionData.tokenId &&
          reporterDisputes.some((dispute) => dispute.tokenId === protectionData.tokenId)
        );

        if (!cancelled) {
          setProtection(protectionData);
          setCounterStake(counterStakeWei);
          setReportingPolicy(policy);
          setAlreadyReported(hasExistingReport);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load report prerequisites.");
        }
      } finally {
        if (!cancelled) {
          setLoadingProtection(false);
        }
      }
    };

    void loadProtection();

    return () => {
      cancelled = true;
    };
  }, [releaseId, getRequiredCounterStake, address]);

  const handleSubmit = async () => {
    if (!address) return;
    if (!primaryEvidenceTitle.trim()) {
      setError("Evidence title is required");
      return;
    }
    if (!evidenceURL.trim()) {
      setError("Evidence URL is required");
      return;
    }
    if (!claimedRightsholder.trim()) {
      setError("Claimed rightsholder is required");
      return;
    }
    if (!narrativeSummary.trim()) {
      setError("A narrative summary is required");
      return;
    }

    setError(null);

    try {
      if (!protection?.tokenId || !protection.attested) {
        throw new Error("This release does not have an attested on-chain protection record to dispute yet.");
      }
      if (reportingPolicy?.requiresHumanVerification) {
        throw new Error("Proof-of-humanity is required before you can file more disputes.");
      }
      if (alreadyReported) {
        throw new Error("This wallet already reported this release. Use the existing dispute or appeal flow instead.");
      }

      const result = await report({
        tokenId: BigInt(protection.tokenId),
        evidenceURI: evidenceURL.trim(),
      });

      if (!token) {
        throw new Error("You must be signed in to submit typed evidence.");
      }

      await submitRightsEvidenceBundle({
        subjectType: result.disputeId ? "dispute" : "release",
        subjectId: result.disputeId
          ? `dispute_${result.disputeId.toString()}_${chainId}`
          : releaseId,
        submittedByRole: "reporter",
        submittedByAddress: address.toLowerCase(),
        purpose: "dispute_report",
        summary: narrativeSummary.trim(),
        evidences: [
          {
            kind: primaryEvidenceKind,
            title: primaryEvidenceTitle.trim(),
            description: primaryEvidenceDescription.trim() || null,
            sourceUrl: evidenceURL.trim(),
            claimedRightsholder: claimedRightsholder.trim(),
            strength: evidenceStrength,
          },
        ],
      }, token);

      onSubmitted?.({
        disputeId: result.disputeId?.toString(),
        txHash: result.hash,
        tokenId: result.tokenId?.toString(),
        counterStakeEth: formatEth(result.counterStake),
      });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    }
  };

  if (!address) return null;

  const isDisabled =
    pending ||
    loadingProtection ||
    !primaryEvidenceTitle.trim() ||
    !evidenceURL.trim() ||
    !claimedRightsholder.trim() ||
    !narrativeSummary.trim() ||
    !protection?.tokenId ||
    !protection.attested ||
    reportingPolicy?.requiresHumanVerification ||
    alreadyReported;

  const tokenDisplay = protection?.tokenId
    ? protection.tokenId.length > 16
      ? `${protection.tokenId.slice(0, 8)}...${protection.tokenId.slice(-4)}`
      : protection.tokenId
    : null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      {/* Injected keyframes */}
      <style>{`
        @keyframes modal-enter {
          from { opacity: 0; transform: scale(0.95) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>

      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Top accent line */}
        <div style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          height: "2px",
          background: "linear-gradient(90deg, transparent, #ef4444, transparent)",
          opacity: 0.6,
          borderRadius: "16px 16px 0 0",
        }} />

        {/* Header */}
        <div style={headerStyle}>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            <div style={{
              width: "36px",
              height: "36px",
              borderRadius: "10px",
              background: "rgba(239,68,68,0.1)",
              border: "1px solid rgba(239,68,68,0.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#ef4444",
            }}>
              <IconFlag size={18} />
            </div>
            <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
              Report Content
            </h2>
          </div>
          <button onClick={onClose} style={closeBtnStyle}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Step Indicator */}
        <StepIndicator currentPhase={currentPhase} />

        {/* Info warning */}
        <div style={infoBoxStyle}>
          <div style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }}>
            <IconAlertCircle size={16} />
          </div>
          <p style={{ margin: 0, fontSize: "13px", opacity: 0.8, lineHeight: 1.5 }}>
            Flag this content as potentially stolen. You must provide evidence
            supporting your claim. False reports may result in reputation
            penalties.
          </p>
        </div>

        {/* Info Panel (protection + stake) */}
        <div style={infoPanelStyle}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
            <div>
              <div style={infoLabelStyle}>Protection Record</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px" }}>
                <span style={{ fontFamily: "monospace", fontSize: "13px", opacity: 0.7 }}>
                  {loadingProtection ? "Loading..." : tokenDisplay || "Unavailable"}
                </span>
                {tokenDisplay && (
                  <button
                    onClick={() => copyToClipboard(protection!.tokenId!, "token")}
                    style={copyBtnStyle}
                    title="Copy token ID"
                  >
                    {copiedId === "token" ? <IconCheck /> : <IconCopy />}
                  </button>
                )}
              </div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={infoLabelStyle}>Counter-Stake</div>
              <div style={{ display: "flex", alignItems: "center", gap: "6px", marginTop: "4px", justifyContent: "flex-end" }}>
                <span style={{ color: "#f59e0b" }}><IconDiamond size={14} /></span>
                <span style={{ fontSize: "16px", fontWeight: 700, color: "#f59e0b" }}>
                  {counterStake != null ? formatEth(counterStake) : "..."}
                </span>
              </div>
            </div>
          </div>
          {reportingPolicy && (
            <div style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "6px",
              padding: "4px 10px",
              borderRadius: "6px",
              background: "rgba(255,255,255,0.04)",
              border: "1px solid rgba(255,255,255,0.06)",
              fontSize: "11px",
              color: "rgba(255,255,255,0.5)",
            }}>
              <span style={{ fontWeight: 600 }}>{reportingPolicy.stakeTier.label}</span>
              <span style={{ opacity: 0.6 }}>{reportingPolicy.message}</span>
            </div>
          )}
        </div>

        {/* Warnings */}
        {reportingPolicy?.requiresHumanVerification && address && (
          <div style={warningStyle}>
            <div style={{ color: "#f59e0b", flexShrink: 0, marginTop: "1px" }}>
              <IconAlertTriangle size={16} />
            </div>
            <div>
              Proof-of-humanity is required before you can submit another report.
              <a href={`/curators/${address}?verify=1`} style={{ color: "#fde68a", marginLeft: "6px" }}>
                Verify this wallet
              </a>
            </div>
          </div>
        )}

        {alreadyReported && (
          <div style={warningStyle}>
            <div style={{ color: "#f59e0b", flexShrink: 0, marginTop: "1px" }}>
              <IconAlertTriangle size={16} />
            </div>
            <div>
              This wallet already filed a report for this release. Use the existing dispute or appeal flow instead.
              <a href="/disputes" style={{ color: "#fde68a", marginLeft: "6px" }}>
                Open disputes
              </a>
            </div>
          </div>
        )}

        {/* Primary evidence kind */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Primary Evidence Type *</label>
          <select
            value={primaryEvidenceKind}
            onChange={(e) => setPrimaryEvidenceKind(e.target.value as RightsEvidenceKind)}
            disabled={!!alreadyReported}
            style={inputStyle}
          >
            {PRIMARY_EVIDENCE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span style={hintStyle}>
            {PRIMARY_EVIDENCE_OPTIONS.find((option) => option.value === primaryEvidenceKind)?.hint}
          </span>
        </div>

        {/* Evidence title */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Evidence Title *</label>
          <input
            type="text"
            placeholder="Official release page, catalog match, account-control proof..."
            value={primaryEvidenceTitle}
            onChange={(e) => setPrimaryEvidenceTitle(e.target.value)}
            disabled={!!alreadyReported}
            style={inputStyle}
          />
        </div>

        {/* Claimed rightsholder */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Claimed Rightsholder *</label>
          <input
            type="text"
            placeholder="Artist, label, distributor, or rights owner"
            value={claimedRightsholder}
            onChange={(e) => setClaimedRightsholder(e.target.value)}
            disabled={!!alreadyReported}
            style={inputStyle}
          />
        </div>

        {/* Evidence URL */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Evidence URL *</label>
          <div style={{ position: "relative" }}>
            <div style={{
              position: "absolute",
              left: "12px",
              top: "50%",
              transform: "translateY(-50%)",
              color: "rgba(255,255,255,0.25)",
              pointerEvents: "none",
            }}>
              <IconLink />
            </div>
            <input
              type="url"
              placeholder="https://... (link to original content)"
              value={evidenceURL}
              onChange={(e) => setEvidenceURL(e.target.value)}
              disabled={!!alreadyReported}
              style={{ ...inputStyle, paddingLeft: "36px" }}
            />
          </div>
          <span style={hintStyle}>
            Accepted: original content links, timestamps, blockchain records
          </span>
        </div>

        {/* Evidence strength */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Evidence Strength *</label>
          <select
            value={evidenceStrength}
            onChange={(e) => setEvidenceStrength(e.target.value as RightsEvidenceStrength)}
            disabled={!!alreadyReported}
            style={inputStyle}
          >
            {STRENGTH_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </div>

        {/* Supporting detail */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Supporting Detail</label>
          <textarea
            placeholder="Optional notes about the linked evidence item..."
            value={primaryEvidenceDescription}
            onChange={(e) => setPrimaryEvidenceDescription(e.target.value)}
            disabled={!!alreadyReported}
            style={{ ...inputStyle, minHeight: "84px", resize: "vertical" }}
          />
        </div>

        {/* Narrative summary */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Narrative Summary *</label>
          <textarea
            placeholder="Explain why this report matters, what right is being claimed, and how this evidence supports it..."
            value={narrativeSummary}
            onChange={(e) => setNarrativeSummary(e.target.value)}
            disabled={!!alreadyReported}
            style={{ ...inputStyle, minHeight: "100px", resize: "vertical" }}
          />
          <span style={hintStyle}>
            Reports need both a primary evidence record and a plain-language summary.
          </span>
        </div>

        {/* Error */}
        {error && (
          <div style={errorStyle}>
            <div style={{ color: "#ef4444", flexShrink: 0, marginTop: "1px" }}>
              <IconAlertCircle size={16} />
            </div>
            <span>{error}</span>
          </div>
        )}

        {/* Actions */}
        <div style={actionsStyle}>
          <button onClick={onClose} style={cancelBtnStyle}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={!!isDisabled}
            style={{
              ...submitBtnStyle,
              opacity: isDisabled ? 0.4 : 1,
              cursor: isDisabled ? "not-allowed" : "pointer",
            }}
          >
            <IconFlag size={14} />
            {pending ? "Submitting..." : "File Report"}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Styles ─────────────────────────────────────────────────────── */

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.75)",
  backdropFilter: "blur(12px)",
  WebkitBackdropFilter: "blur(12px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  position: "relative",
  background: "linear-gradient(170deg, rgba(30,30,40,0.98) 0%, rgba(18,18,24,0.99) 100%)",
  border: "1px solid rgba(239,68,68,0.12)",
  borderRadius: "20px",
  padding: "28px",
  width: "100%",
  maxWidth: "480px",
  maxHeight: "90vh",
  overflow: "auto",
  boxShadow: "0 24px 80px rgba(0,0,0,0.6), 0 0 0 1px rgba(255,255,255,0.04), 0 0 40px rgba(239,68,68,0.06)",
  animation: "modal-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "20px",
};

const closeBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "8px",
  width: "32px",
  height: "32px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "rgba(255,255,255,0.5)",
  cursor: "pointer",
  transition: "all 0.15s",
};

const infoBoxStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  background: "rgba(239, 68, 68, 0.06)",
  border: "1px solid rgba(239, 68, 68, 0.15)",
  borderLeft: "3px solid rgba(239, 68, 68, 0.4)",
  borderRadius: "10px",
  padding: "12px 14px",
  marginBottom: "20px",
};

const infoPanelStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "14px",
  padding: "16px",
  marginBottom: "20px",
};

const infoLabelStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 600,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  color: "rgba(255,255,255,0.35)",
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

const warningStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  background: "rgba(245, 158, 11, 0.08)",
  border: "1px solid rgba(245, 158, 11, 0.2)",
  borderLeft: "3px solid rgba(245, 158, 11, 0.4)",
  borderRadius: "10px",
  padding: "12px 14px",
  marginBottom: "18px",
  color: "#fef3c7",
  fontSize: "13px",
  lineHeight: 1.5,
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: "16px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  fontWeight: 600,
  color: "rgba(255,255,255,0.4)",
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: "6px",
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "10px",
  padding: "12px 14px",
  fontSize: "13px",
  color: "#fff",
  outline: "none",
  boxSizing: "border-box",
  transition: "border-color 0.15s",
};

const hintStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  opacity: 0.35,
  marginTop: "6px",
};

const errorStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: "10px",
  background: "rgba(239, 68, 68, 0.08)",
  border: "1px solid rgba(239, 68, 68, 0.2)",
  borderLeft: "3px solid rgba(239, 68, 68, 0.4)",
  borderRadius: "10px",
  padding: "10px 14px",
  fontSize: "13px",
  color: "#fca5a5",
  marginBottom: "16px",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: "12px",
  justifyContent: "flex-end",
  marginTop: "4px",
};

const cancelBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.04)",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "10px",
  padding: "11px 22px",
  color: "rgba(255,255,255,0.7)",
  fontSize: "13px",
  cursor: "pointer",
  transition: "all 0.15s",
};

const submitBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "8px",
  background: "linear-gradient(135deg, #ef4444, #dc2626)",
  border: "none",
  borderRadius: "10px",
  padding: "11px 22px",
  color: "#fff",
  fontSize: "13px",
  fontWeight: 600,
  transition: "all 0.2s",
  boxShadow: "0 2px 12px rgba(239,68,68,0.25)",
};
