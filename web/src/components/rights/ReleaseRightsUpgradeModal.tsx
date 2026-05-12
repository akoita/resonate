"use client";

import { useMemo, useState, useCallback } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import {
  submitReleaseRightsUpgradeRequest,
  type ReleaseRightsUpgradeRequestRecord,
  type ReleaseRightsUpgradeRequestedRoute,
  type RightsEvidenceKind,
  type RightsEvidenceStrength,
} from "../../lib/api";
import {
  CREATOR_RIGHTS_EVIDENCE_OPTIONS,
  RIGHTS_EVIDENCE_STRENGTH_OPTIONS,
  SUBMITTED_RIGHTS_EVIDENCE_COPY,
  normalizeRightsEvidenceUrl,
  normalizeRightsEvidenceUrlList,
} from "../../lib/rightsEvidence";
import type { RightsOnboardingContext } from "../../lib/rightsOnboarding";

type ReleaseRightsUpgradeModalProps = {
  releaseId: string;
  releaseTitle: string;
  onClose: () => void;
  onSubmitted: (request: ReleaseRightsUpgradeRequestRecord) => void;
  existingDecisionReason?: string | null;
  onboardingContext?: RightsOnboardingContext | null;
};

export default function ReleaseRightsUpgradeModal({
  releaseId,
  releaseTitle,
  onClose,
  onSubmitted,
  existingDecisionReason,
  onboardingContext,
}: ReleaseRightsUpgradeModalProps) {
  const { token } = useAuth();
  const { addToast } = useToast();
  const guidedContext =
    onboardingContext?.mode === "guided_trusted_source" ? onboardingContext : null;
  const guidedPrefill = guidedContext?.prefill;
  const [requestedRoute, setRequestedRoute] =
    useState<ReleaseRightsUpgradeRequestedRoute>(guidedPrefill?.requestedRoute ?? "STANDARD_ESCROW");
  const [summary, setSummary] = useState(guidedPrefill?.summary ?? "");
  const [evidenceKind, setEvidenceKind] = useState<RightsEvidenceKind>(
    guidedPrefill?.evidenceKind ?? "proof_of_control",
  );
  const [title, setTitle] = useState(guidedPrefill?.title ?? "");
  const [sourceUrl, setSourceUrl] = useState(guidedPrefill?.sourceUrl ?? "");
  const [claimedRightsholder, setClaimedRightsholder] = useState(
    guidedPrefill?.claimedRightsholder ?? "",
  );
  const [sourceLabel, setSourceLabel] = useState(guidedPrefill?.sourceLabel ?? "");
  const [artistName, setArtistName] = useState(guidedPrefill?.artistName ?? "");
  const [publicationDate, setPublicationDate] = useState("");
  const [isrc, setIsrc] = useState("");
  const [upc, setUpc] = useState("");
  const [attachmentUrls, setAttachmentUrls] = useState("");
  const [description, setDescription] = useState(guidedPrefill?.description ?? "");
  const [strength, setStrength] = useState<RightsEvidenceStrength>(
    guidedPrefill?.strength ?? "high",
  );
  const [submitting, setSubmitting] = useState(false);
  const [showOptional, setShowOptional] = useState(Boolean(guidedPrefill));

  const selectedEvidence = useMemo(
    () => CREATOR_RIGHTS_EVIDENCE_OPTIONS.find((option) => option.value === evidenceKind),
    [evidenceKind],
  );

  const optionalFieldCount = useMemo(() => {
    let count = 0;
    if (sourceLabel.trim()) count++;
    if (artistName.trim()) count++;
    if (publicationDate.trim()) count++;
    if (isrc.trim()) count++;
    if (upc.trim()) count++;
    if (attachmentUrls.trim()) count++;
    return count;
  }, [sourceLabel, artistName, publicationDate, isrc, upc, attachmentUrls]);

  const toggleOptional = useCallback(() => setShowOptional((v) => !v), []);

  const hasSourceEvidence = sourceUrl.trim().length > 0 || description.trim().length > 0;
  const canSubmit =
    summary.trim().length > 20 &&
    title.trim().length > 0 &&
    claimedRightsholder.trim().length > 0 &&
    (guidedContext ? hasSourceEvidence : sourceUrl.trim().length > 0);

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
          message: guidedContext
            ? "Please complete the summary, rightsholder, and reviewer context before submitting."
            : "Please complete the summary and primary evidence fields before submitting.",
        });
      return;
    }

    setSubmitting(true);
    try {
      let normalizedSourceUrl = "";
      let normalizedAttachments: string[] = [];

      try {
        normalizedSourceUrl = normalizeRightsEvidenceUrl(sourceUrl);
        normalizedAttachments = normalizeRightsEvidenceUrlList(attachmentUrls);
      } catch (error) {
        addToast({
          type: "warning",
          title: "Invalid URL",
          message:
            error instanceof Error
              ? error.message
              : "Please provide valid evidence URLs before submitting.",
        });
        return;
      }

      const request = await submitReleaseRightsUpgradeRequest(
        releaseId,
        {
          summary: summary.trim(),
          requestedRoute,
          evidences: [
            {
              kind: evidenceKind,
              title: title.trim(),
              sourceUrl: normalizedSourceUrl,
              sourceLabel: sourceLabel.trim() || undefined,
              claimedRightsholder: claimedRightsholder.trim(),
              artistName: artistName.trim() || undefined,
              description: description.trim() || undefined,
              releaseTitle,
              publicationDate: publicationDate.trim() || undefined,
              isrc: isrc.trim() || undefined,
              upc: upc.trim() || undefined,
              strength,
              verificationStatus: "unverified",
              attachments: normalizedAttachments,
              metadata: {
                submissionContext: "release_rights_upgrade",
                evidenceLabel: selectedEvidence?.label,
                onboardingMode: guidedContext ? "guided_trusted_source" : "manual",
                trustedSourceLinkId: guidedContext?.trustedSourceLinkId,
                trustedSourceId: guidedContext?.trustedSourceId,
                trustedSourceType: guidedContext?.trustedSourceType,
                trustedSourceTrustLevel: guidedContext?.trustedSourceTrustLevel,
                recommendedRoute: guidedContext?.recommendedRoute,
              },
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
            <h3 style={{ margin: 0, fontSize: "20px", fontWeight: 700 }}>
              {guidedContext ? "Guided Rights Evidence" : "Submit Rights Evidence"}
            </h3>
            <p style={{ margin: "6px 0 0", color: "rgba(255,255,255,0.48)", fontSize: "13px", lineHeight: 1.5 }}>
              {guidedContext
                ? (
                    <>
                      Use the trusted-source context for <strong style={{ color: "rgba(255,255,255,0.72)" }}>{releaseTitle}</strong>. Reviewers still decide whether it supports marketplace access.
                    </>
                  )
                : (
                    <>
                      Share structured evidence for <strong style={{ color: "rgba(255,255,255,0.72)" }}>{releaseTitle}</strong>. Reviewers decide whether it supports marketplace access.
                    </>
                  )}
            </p>
          </div>
          <button style={closeButtonStyle} onClick={onClose} aria-label="Close">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {existingDecisionReason && (
          <div style={calloutStyle}>
            <strong style={{ display: "block", marginBottom: 6 }}>Latest reviewer note</strong>
            <span>{existingDecisionReason}</span>
          </div>
        )}

        {guidedContext && (
          <div style={guidedCalloutStyle}>
            <span style={guidedBadgeStyle}>Guided proof-of-control</span>
            <div style={{ fontSize: "13px", color: "rgba(255,255,255,0.64)", lineHeight: 1.5 }}>
              Suggested path: <strong>{guidedContext.recommendedRoute.replaceAll("_", " ")}</strong>.
              This uses {guidedContext.signalLabel}; it is not ownership verification.
            </div>
            <div style={guidedReasonListStyle}>
              {guidedContext.reasons.map((reason) => (
                <span key={reason} style={guidedReasonStyle}>{reason}</span>
              ))}
            </div>
          </div>
        )}

        <div style={submittedEvidenceNoticeStyle}>
          <span style={submittedEvidenceBadgeStyle}>Submitted evidence</span>
          <span>{SUBMITTED_RIGHTS_EVIDENCE_COPY}</span>
        </div>

        {/* ── Required Fields ────────────────────────────────── */}
        <div style={sectionHeaderStyle}>Required</div>

        <div style={gridStyle}>
          <label style={fieldStyle}>
            <span style={labelStyle}>Requested path *</span>
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
            <span style={labelStyle}>Primary evidence type *</span>
            <select
              value={evidenceKind}
              onChange={(event) => setEvidenceKind(event.target.value as RightsEvidenceKind)}
              style={inputStyle}
            >
              {CREATOR_RIGHTS_EVIDENCE_OPTIONS.map((option) => (
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
          <span style={labelStyle}>Rights summary *</span>
          <textarea
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
            rows={3}
            style={{ ...inputStyle, resize: "vertical", minHeight: 80 }}
            placeholder="Summarize the rightsholder, publishing authority, prior distribution history, and proof-of-control context reviewers should consider."
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
            <span style={labelStyle}>Evidence title *</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              style={inputStyle}
              placeholder={selectedEvidence?.titlePlaceholder || "Official distributor dashboard"}
            />
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Claimed rightsholder *</span>
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
            <span style={labelStyle}>Evidence URL {guidedContext ? "" : "*"}</span>
            <input
              value={sourceUrl}
              onChange={(event) => setSourceUrl(event.target.value)}
              style={inputStyle}
              placeholder={selectedEvidence?.sourceUrlPlaceholder || "https://..."}
            />
            {guidedContext && (
              <span style={hintStyle}>Optional when the trusted-source context below is enough for review.</span>
            )}
          </label>

          <label style={fieldStyle}>
            <span style={labelStyle}>Evidence strength *</span>
            <select
              value={strength}
              onChange={(event) => setStrength(event.target.value as RightsEvidenceStrength)}
              style={inputStyle}
            >
              {RIGHTS_EVIDENCE_STRENGTH_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* ── Optional Metadata (collapsible) ────────────────── */}
        <button
          type="button"
          onClick={toggleOptional}
          style={optionalToggleStyle}
        >
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <svg
              width="14" height="14" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
              style={{ transition: "transform 0.2s", transform: showOptional ? "rotate(90deg)" : "rotate(0deg)" }}
            >
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span>Additional metadata</span>
            {optionalFieldCount > 0 && (
              <span style={{
                padding: "1px 7px",
                borderRadius: "999px",
                background: "rgba(124,92,255,0.15)",
                color: "#a78bfa",
                fontSize: "10px",
                fontWeight: 700,
              }}>
                {optionalFieldCount} filled
              </span>
            )}
          </div>
          <span style={{ fontSize: "11px", color: "rgba(255,255,255,0.32)" }}>
            ISRC, UPC, artist, publication date, docs
          </span>
        </button>

        {showOptional && (
          <div style={optionalSectionStyle}>
            <div style={gridStyle}>
              <label style={fieldStyle}>
                <span style={labelStyle}>Source label</span>
                <input
                  value={sourceLabel}
                  onChange={(event) => setSourceLabel(event.target.value)}
                  style={inputStyle}
                  placeholder={selectedEvidence?.sourceLabelPlaceholder || "Spotify artist page, distributor portal"}
                />
              </label>

              <label style={fieldStyle}>
                <span style={labelStyle}>Artist name</span>
                <input
                  value={artistName}
                  onChange={(event) => setArtistName(event.target.value)}
                  style={inputStyle}
                  placeholder="Official artist name"
                />
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
                  rows={2}
                  style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
                  placeholder="One URL per line"
                />
              </label>
            </div>
          </div>
        )}

        {/* ── Context ─────────────────────────────────────────── */}
        <label style={fieldStyle}>
          <span style={labelStyle}>Evidence context</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            style={{ ...inputStyle, resize: "vertical", minHeight: 60 }}
            placeholder={selectedEvidence?.contextPlaceholder || "Add any details that help a reviewer understand the evidence quickly."}
          />
        </label>

        <div style={footerStyle}>
          <div style={{ color: "rgba(255,255,255,0.45)", fontSize: "12px", lineHeight: 1.5 }}>
            This packet is stored as submitted evidence. Only reviewer approval can move the release to Platform Reviewed or Rights Verified.
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
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "rgba(255,255,255,0.5)",
  borderRadius: "10px",
  width: "36px",
  height: "36px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  padding: 0,
  flexShrink: 0,
  transition: "all 0.15s",
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

const guidedCalloutStyle: React.CSSProperties = {
  display: "flex",
  flexDirection: "column",
  gap: "10px",
  marginBottom: "18px",
  padding: "14px 16px",
  borderRadius: "14px",
  border: "1px solid rgba(59, 130, 246, 0.24)",
  background: "rgba(59, 130, 246, 0.08)",
};

const guidedBadgeStyle: React.CSSProperties = {
  alignSelf: "flex-start",
  padding: "3px 8px",
  borderRadius: "999px",
  border: "1px solid rgba(96, 165, 250, 0.32)",
  background: "rgba(96, 165, 250, 0.12)",
  color: "#93c5fd",
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
};

const guidedReasonListStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "6px",
};

const guidedReasonStyle: React.CSSProperties = {
  padding: "3px 8px",
  borderRadius: "999px",
  border: "1px solid rgba(255,255,255,0.08)",
  background: "rgba(255,255,255,0.04)",
  color: "rgba(255,255,255,0.62)",
  fontSize: "11px",
};

const submittedEvidenceNoticeStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: "10px",
  marginBottom: "18px",
  padding: "12px 14px",
  borderRadius: "14px",
  border: "1px solid rgba(245, 158, 11, 0.22)",
  background: "rgba(245, 158, 11, 0.07)",
  color: "rgba(255,255,255,0.62)",
  fontSize: "12px",
  lineHeight: 1.45,
};

const submittedEvidenceBadgeStyle: React.CSSProperties = {
  flexShrink: 0,
  padding: "3px 8px",
  borderRadius: "999px",
  border: "1px solid rgba(245, 158, 11, 0.3)",
  background: "rgba(245, 158, 11, 0.1)",
  color: "#fbbf24",
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.06em",
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

const sectionHeaderStyle: React.CSSProperties = {
  fontSize: "10px",
  fontWeight: 700,
  textTransform: "uppercase",
  letterSpacing: "0.1em",
  color: "rgba(255,255,255,0.35)",
  marginBottom: "12px",
  paddingBottom: "8px",
  borderBottom: "1px solid rgba(255,255,255,0.05)",
};

const optionalToggleStyle: React.CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: "12px",
  padding: "12px 14px",
  marginBottom: "12px",
  background: "rgba(255,255,255,0.02)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "12px",
  color: "rgba(255,255,255,0.6)",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
  transition: "all 0.15s",
};

const optionalSectionStyle: React.CSSProperties = {
  padding: "2px 0 4px",
  marginBottom: "4px",
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
