"use client";

import { useState } from "react";
import { useAuth } from "../auth/AuthProvider";

interface ReportContentModalProps {
  tokenId: string;
  creatorAddr: string;
  onClose: () => void;
  onSubmitted?: () => void;
}

export default function ReportContentModal({
  tokenId,
  creatorAddr: _creatorAddr,
  onClose,
  onSubmitted,
}: ReportContentModalProps) {
  const { address } = useAuth();
  const [evidenceURL, setEvidenceURL] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!address) return;
    if (!evidenceURL.trim()) {
      setError("Evidence URL is required");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/metadata/disputes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tokenId,
          reporterAddr: address,
          evidenceURI: evidenceURL.trim(),
          counterStake: "0", // On-chain counter-stake handled by wallet tx
        }),
      });

      if (!res.ok) throw new Error("Failed to file dispute");
      onSubmitted?.();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setSubmitting(false);
    }
  };

  if (!address) return null;

  return (
    <div style={overlayStyle} onClick={onClose}>
      <div style={modalStyle} onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div style={headerStyle}>
          <h2 style={{ margin: 0, fontSize: "18px", fontWeight: 600 }}>
            🚩 Report Content
          </h2>
          <button onClick={onClose} style={closeBtnStyle}>
            ✕
          </button>
        </div>

        {/* Info */}
        <div style={infoBoxStyle}>
          <p style={{ margin: 0, fontSize: "13px", opacity: 0.8 }}>
            Flag this content as potentially stolen. You must provide evidence
            supporting your claim. False reports may result in reputation
            penalties.
          </p>
        </div>

        {/* Token info */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Token ID</label>
          <div style={readOnlyFieldStyle}>{tokenId}</div>
        </div>

        {/* Evidence URL */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Evidence URL *</label>
          <input
            type="url"
            placeholder="https://... (link to original content)"
            value={evidenceURL}
            onChange={(e) => setEvidenceURL(e.target.value)}
            style={inputStyle}
          />
          <span style={hintStyle}>
            Link to the original source (YouTube, Spotify, SoundCloud, etc.)
          </span>
        </div>

        {/* Description */}
        <div style={fieldGroupStyle}>
          <label style={labelStyle}>Description</label>
          <textarea
            placeholder="Describe why you believe this content is stolen..."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ ...inputStyle, minHeight: "80px", resize: "vertical" }}
          />
        </div>

        {/* Error */}
        {error && (
          <div style={errorStyle}>⚠️ {error}</div>
        )}

        {/* Actions */}
        <div style={actionsStyle}>
          <button onClick={onClose} style={cancelBtnStyle}>
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !evidenceURL.trim()}
            style={{
              ...submitBtnStyle,
              opacity: submitting || !evidenceURL.trim() ? 0.5 : 1,
            }}
          >
            {submitting ? "Submitting..." : "🚩 File Report"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Styles ----

const overlayStyle: React.CSSProperties = {
  position: "fixed",
  inset: 0,
  background: "rgba(0,0,0,0.7)",
  backdropFilter: "blur(4px)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  zIndex: 1000,
};

const modalStyle: React.CSSProperties = {
  background: "#1a1a2e",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "16px",
  padding: "24px",
  width: "100%",
  maxWidth: "480px",
  maxHeight: "90vh",
  overflow: "auto",
};

const headerStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  marginBottom: "16px",
};

const closeBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#fff",
  fontSize: "18px",
  cursor: "pointer",
  opacity: 0.5,
};

const infoBoxStyle: React.CSSProperties = {
  background: "rgba(239, 68, 68, 0.08)",
  border: "1px solid rgba(239, 68, 68, 0.2)",
  borderRadius: "10px",
  padding: "12px",
  marginBottom: "20px",
};

const fieldGroupStyle: React.CSSProperties = {
  marginBottom: "16px",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "12px",
  fontWeight: 500,
  opacity: 0.6,
  textTransform: "uppercase",
  letterSpacing: "0.5px",
  marginBottom: "6px",
};

const readOnlyFieldStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.03)",
  border: "1px solid rgba(255,255,255,0.06)",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "13px",
  fontFamily: "monospace",
  opacity: 0.7,
};

const inputStyle: React.CSSProperties = {
  width: "100%",
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "13px",
  color: "#fff",
  outline: "none",
  boxSizing: "border-box",
};

const hintStyle: React.CSSProperties = {
  display: "block",
  fontSize: "11px",
  opacity: 0.4,
  marginTop: "4px",
};

const errorStyle: React.CSSProperties = {
  background: "rgba(239, 68, 68, 0.1)",
  border: "1px solid rgba(239, 68, 68, 0.3)",
  borderRadius: "8px",
  padding: "10px 12px",
  fontSize: "13px",
  color: "#ef4444",
  marginBottom: "16px",
};

const actionsStyle: React.CSSProperties = {
  display: "flex",
  gap: "12px",
  justifyContent: "flex-end",
};

const cancelBtnStyle: React.CSSProperties = {
  background: "rgba(255,255,255,0.05)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "8px",
  padding: "10px 20px",
  color: "#fff",
  fontSize: "13px",
  cursor: "pointer",
};

const submitBtnStyle: React.CSSProperties = {
  background: "linear-gradient(135deg, #ef4444, #dc2626)",
  border: "none",
  borderRadius: "8px",
  padding: "10px 20px",
  color: "#fff",
  fontSize: "13px",
  fontWeight: 600,
  cursor: "pointer",
};
