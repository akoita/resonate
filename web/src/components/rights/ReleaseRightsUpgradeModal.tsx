"use client";

import { useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  submitReleaseRightsUpgradeRequest,
  type ReleaseRightsUpgradeRequestRecord,
  type ReleaseRightsUpgradeRequestedRoute,
  type RightsEvidenceKind,
  type RightsEvidenceStrength,
} from "../../lib/api";

type ReleaseRightsUpgradeModalProps = {
  releaseId: string;
  releaseTitle: string;
  onClose: () => void;
  onSubmitted: (request: ReleaseRightsUpgradeRequestRecord) => void;
  existingDecisionReason?: string | null;
};

const EVIDENCE_OPTIONS: Array<{
  value: RightsEvidenceKind;
  label: string;
  hint: string;
}> = [
  {
    value: "proof_of_control",
    label: "Proof of control",
    hint: "Official profile, verified social, artist website, or distributor dashboard proof.",
  },
  {
    value: "prior_publication",
    label: "Prior publication",
    hint: "Canonical release pages, prior publication records, or official DSP links.",
  },
  {
    value: "rights_metadata",
    label: "Rights metadata",
    hint: "ISRC, UPC, split sheet, label metadata, or rights package reference.",
  },
  {
    value: "trusted_catalog_reference",
    label: "Trusted catalog reference",
    hint: "Label, distributor, or trusted catalog record that links you to this release.",
  },
  {
    value: "legal_notice",
    label: "Signed declaration",
    hint: "Signed declaration, authorization letter, or formal rights statement from the rightsholder.",
  },
];

const STRENGTH_OPTIONS: Array<{ value: RightsEvidenceStrength; label: string }> = [
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
  { value: "very_high", label: "Very High" },
];

export default function ReleaseRightsUpgradeModal({
  releaseId,
  releaseTitle,
  onClose,
  onSubmitted,
  existingDecisionReason,
}: ReleaseRightsUpgradeModalProps) {
  const { token } = useAuth();
  const { addToast } = useToast();
  const [requestedRoute, setRequestedRoute] =
    useState<ReleaseRightsUpgradeRequestedRoute>("STANDARD_ESCROW");
  const [summary, setSummary] = useState("");
  const [evidenceKind, setEvidenceKind] = useState<RightsEvidenceKind>("proof_of_control");
  const [title, setTitle] = useState("");
  const [sourceUrl, setSourceUrl] = useState("");
  const [claimedRightsholder, setClaimedRightsholder] = useState("");
  const [sourceLabel, setSourceLabel] = useState("");
  const [artistName, setArtistName] = useState("");
  const [publicationDate, setPublicationDate] = useState("");
  const [isrc, setIsrc] = useState("");
  const [upc, setUpc] = useState("");
  const [attachmentUrls, setAttachmentUrls] = useState("");
  const [description, setDescription] = useState("");
  const [strength, setStrength] = useState<RightsEvidenceStrength>("high");
  const [submitting, setSubmitting] = useState(false);

  const selectedEvidence = useMemo(
    () => EVIDENCE_OPTIONS.find((option) => option.value === evidenceKind),
    [evidenceKind],
  );

  const canSubmit =
    summary.trim().length > 20 &&
    title.trim().length > 0 &&
    sourceUrl.trim().length > 0 &&
    claimedRightsholder.trim().length > 0;

  const handleSubmit = async () => {
    if (!token) {
      addToast({
        type: "error",
        title: "Sign in required",
        message: "You need to be signed in as the release owner to request a rights upgrade.",
      });
      return;
    }

    if (!canSubmit) {
      addToast({
        type: "warning",
        title: "More information needed",
        message: "Please complete the summary and primary evidence fields before submitting.",
      });
      return;
    }

    setSubmitting(true);
    try {
      const request = await submitReleaseRightsUpgradeRequest(
        releaseId,
        {
          summary: summary.trim(),
          requestedRoute,
          evidences: [
            {
              kind: evidenceKind,
              title: title.trim(),
              sourceUrl: sourceUrl.trim(),
              sourceLabel: sourceLabel.trim() || undefined,
              claimedRightsholder: claimedRightsholder.trim(),
              artistName: artistName.trim() || undefined,
              description: description.trim() || undefined,
              releaseTitle,
              publicationDate: publicationDate.trim() || undefined,
              isrc: isrc.trim() || undefined,
              upc: upc.trim() || undefined,
              strength,
              attachments: attachmentUrls
                .split("\n")
                .map((value) => value.trim())
                .filter(Boolean),
            },
          ],
        },
        token,
      );

      addToast({
        type: "success",
        title: "Rights review submitted",
        message:
          request.status === "submitted"
            ? "Your request is now in the review queue."
            : "Your additional evidence has been submitted for review.",
      });
      onSubmitted(request);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not submit the rights-upgrade request.";
      addToast({
        type: "error",
        title: "Submission failed",
        message,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div className="rights-modal" style={modalStyle} onClick={(event) => event.stopPropagation()}>
        <style>{`
          .rights-modal input:focus, .rights-modal select:focus, .rights-modal textarea:focus {
            border-color: rgba(124,92,255,0.5) !important;
            box-shadow: 0 0 0 3px rgba(124,92,255,0.12) !important;
          }
          .rights-modal button:not(:disabled):hover {
            filter: brightness(1.1);
          }
        `}</style>
        <div style={headerStyle}>
          <div>
            <h3 style={{ margin: 0, fontSize: "22px", fontWeight: 700 }}>
              Unlock Marketplace Rights
            </h3>
            <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.55)", fontSize: "13px", lineHeight: 1.5 }}>
              Submit proof that you control this release so ops can review and potentially promote it to a marketplace-enabled route.
            </p>
          </div>
          <button style={closeButtonStyle} onClick={onClose} aria-label="Close rights-upgrade modal">
            ×
          </button>
        </div>

        {existingDecisionReason && (
          <div style={calloutStyle}>
            <strong style={{ display: "block", marginBottom: 6 }}>Latest reviewer note</strong>
            <span>{existingDecisionReason}</span>
          </div>
        )}

        <div style={gridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Requested path</span>
            <select
              value={requestedRoute}
              onChange={(event) =>
                setRequestedRoute(event.target.value as ReleaseRightsUpgradeRequestedRoute)
              }
              style={inputStyle}
            >
              <option value="STANDARD_ESCROW">Standard Escrow</option>
              <option value="TRUSTED_FAST_PATH">Trusted Fast Path</option>
            </select>
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Primary evidence type</span>
            <select
              value={evidenceKind}
              onChange={(event) => setEvidenceKind(event.target.value as RightsEvidenceKind)}
              style={inputStyle}
            >
              {EVIDENCE_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
            {selectedEvidence && (
              <span style={hintStyle}>{selectedEvidence.hint}</span>
            )}
          </label>
        </div>

        <label style={fieldStyle}>
          <span style={labelStyle}>Rights summary</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={4}
            style={{ ...inputStyle, resize: "vertical", minHeight: 96 }}
            placeholder="Explain why you control this release, how the evidence links you to it, and what route you are requesting."
          />
          <span
            style={{
              fontSize: "11px",
              color: summary.trim().length > 20 ? "rgba(255,255,255,0.3)" : "#f59e0b",
              textAlign: "right",
            }}
          >
            {summary.trim().length}/20 min characters
          </span>
        </label>

        <div style={gridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Evidence title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              style={inputStyle}
              placeholder="Official distributor dashboard"
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Claimed rightsholder</span>
            <input
              value={claimedRightsholder}
              onChange={(event) => setClaimedRightsholder(event.target.value)}
              style={inputStyle}
              placeholder="Artist, label, or company name"
            />
          </label>
        </div>

        <div style={gridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Source label</span>
            <input
              value={sourceLabel}
              onChange={(event) => setSourceLabel(event.target.value)}
              style={inputStyle}
              placeholder="Spotify artist page, distributor portal, label letter"
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Artist name</span>
            <input
              value={artistName}
              onChange={(event) => setArtistName(event.target.value)}
              style={inputStyle}
              placeholder="Official artist name tied to this evidence"
            />
          </label>
        </div>

        <div style={gridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Evidence URL</span>
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              style={inputStyle}
              placeholder="https://…"
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Evidence strength</span>
            <select
              value={strength}
              onChange={(event) => setStrength(event.target.value as RightsEvidenceStrength)}
              style={inputStyle}
            >
              {STRENGTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={gridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Publication date</span>
            <input
              type="date"
              value={publicationDate}
              onChange={(event) => setPublicationDate(event.target.value)}
              style={inputStyle}
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>ISRC</span>
            <input
              value={isrc}
              onChange={(event) => setIsrc(event.target.value.toUpperCase())}
              style={inputStyle}
              placeholder="USRC17607839"
            />
          </label>
        </div>

        <div style={gridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>UPC</span>
            <input
              value={upc}
              onChange={(event) => setUpc(event.target.value)}
              style={inputStyle}
              placeholder="012345678905"
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Supporting document URLs</span>
            <textarea
              value={attachmentUrls}
              onChange={(event) => setAttachmentUrls(event.target.value)}
              rows={3}
              style={{ ...inputStyle, resize: "vertical", minHeight: 88 }}
              placeholder="One URL per line for letters, PDFs, split sheets, or supporting documents."
            />
          </label>
        </div>

        <label style={fieldStyle}>
          <span style={labelStyle}>Evidence context</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", minHeight: 88 }}
            placeholder="Add any details that help a reviewer understand the evidence quickly."
          />
        </label>

        <div style={footerStyle}>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "12px", lineHeight: 1.5 }}>
            Human verification helps reviewer confidence, but this request is decided on proof-of-control and rights evidence.
          </div>
          <div style={{ display: "flex", gap: 10 }}>
            <button style={secondaryButtonStyle} onClick={onClose} disabled={submitting}>
              Cancel
            </button>
            <button
              style={{
                ...primaryButtonStyle,
                opacity: canSubmit && !submitting ? 1 : 0.6,
                cursor: canSubmit && !submitting ? "pointer" : "not-allowed",
              }}
              onClick={handleSubmit}
              disabled={!canSubmit || submitting}
            >
              {submitting ? "Submitting…" : "Submit for Review"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(3, 7, 18, 0.76)",
  backdropFilter: "blur(8px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: "24px",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  width: "min(760px, 100%)",
  maxHeight: "90vh",
  overflowY: "auto",
  background: "linear-gradient(180deg, rgba(20,20,28,0.98), rgba(14,14,22,0.98))",
  border: "1px solid rgba(255,255,255,0.08)",
  borderRadius: "24px",
  padding: "24px",
  boxShadow: "0 28px 80px rgba(0,0,0,0.45)",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: "16px",
  marginBottom: "20px",
};

const closeButtonStyle: React.CSSProperties = {
  border: "none",
  background: "transparent",
  color: "rgba(255,255,255,0.5)",
  fontSize: "30px",
  lineHeight: 1,
  cursor: "pointer",
  padding: 0,
};

const calloutStyle: React.CSSProperties = {
  marginBottom: "18px",
  padding: "14px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(245, 158, 11, 0.22)",
  background: "rgba(120, 53, 15, 0.16)",
  color: "#fcd34d",
  fontSize: "13px",
  lineHeight: 1.5,
};

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: "14px",
};

const fieldStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "8px",
  marginBottom: "16px",
};

const labelStyle: React.CSSProperties = {
  fontSize: "12px",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  color: "rgba(255,255,255,0.58)",
};

const hintStyle: React.CSSProperties = {
  fontSize: "12px",
  color: "rgba(255,255,255,0.42)",
  lineHeight: 1.45,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "white",
  padding: "12px 14px",
  fontSize: "14px",
  outline: "none",
  transition: "border-color 0.15s, box-shadow 0.15s",
};

const footerStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "16px",
  marginTop: "12px",
  paddingTop: "16px",
  borderTop: "1px solid rgba(255,255,255,0.06)",
  flexWrap: "wrap",
};

const secondaryButtonStyle: React.CSSProperties = {
  borderRadius: "12px",
  border: "1px solid rgba(255,255,255,0.12)",
  background: "transparent",
  color: "white",
  padding: "12px 16px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "background 0.15s, border-color 0.15s",
};

const primaryButtonStyle: React.CSSProperties = {
  borderRadius: "12px",
  border: "none",
  background: "linear-gradient(135deg, #7c5cff, #a855f7)",
  color: "white",
  padding: "12px 18px",
  fontWeight: 700,
  transition: "opacity 0.15s, transform 0.1s",
};
