import React, { useEffect } from "react";

interface DuplicatePublishWarningModalProps {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function DuplicatePublishWarningModal({
  isOpen,
  onConfirm,
  onCancel,
}: DuplicatePublishWarningModalProps) {
  // Lock body scroll & handle Escape key
  useEffect(() => {
    if (!isOpen) return;
    document.body.style.overflow = "hidden";
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", handleKey);
    };
  }, [isOpen, onCancel]);

  if (!isOpen) return null;

  return (
    <div style={styles.overlay} onClick={onCancel}>
      <div style={styles.card} onClick={(e) => e.stopPropagation()}>
        {/* Accent bar */}
        <div style={styles.accentBar} />

        {/* Icon */}
        <div style={styles.iconWrapper}>
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
            <line x1="12" y1="9" x2="12" y2="13" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </div>

        {/* Title */}
        <h2 style={styles.title}>Already Published</h2>

        {/* Body */}
        <p style={styles.body}>
          This track was already published in this session. Doing it again will
          create a <span style={styles.highlight}>duplicate release</span> in
          your library and the catalog.
        </p>

        {/* Buttons */}
        <div style={styles.actions}>
          <button style={styles.cancelBtn} onClick={onCancel}>
            Go Back
          </button>
          <button style={styles.confirmBtn} onClick={onConfirm}>
            Publish Anyway
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── self-contained inline styles ────────────────────────────── */
const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: "fixed",
    inset: 0,
    zIndex: 10000, // above everything including the player bar
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    background: "rgba(0, 0, 0, 0.70)",
    backdropFilter: "blur(6px)",
    WebkitBackdropFilter: "blur(6px)",
    animation: "fadeIn 0.15s ease-out",
  },
  card: {
    position: "relative",
    width: "min(420px, 90vw)",
    background: "linear-gradient(165deg, #1a1a2e 0%, #0f0f1a 100%)",
    borderRadius: "16px",
    border: "1px solid rgba(245, 158, 11, 0.25)",
    boxShadow:
      "0 0 40px rgba(245, 158, 11, 0.08), 0 20px 60px rgba(0, 0, 0, 0.5)",
    padding: "32px 28px 24px",
    textAlign: "center" as const,
    overflow: "hidden",
    animation: "scaleIn 0.2s ease-out",
  },
  accentBar: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    height: "3px",
    background: "linear-gradient(90deg, #f59e0b, #ef4444, #f59e0b)",
    borderRadius: "16px 16px 0 0",
  },
  iconWrapper: {
    width: "56px",
    height: "56px",
    borderRadius: "50%",
    background: "rgba(245, 158, 11, 0.1)",
    border: "1px solid rgba(245, 158, 11, 0.25)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    margin: "0 auto 16px",
  },
  title: {
    margin: "0 0 12px",
    fontSize: "1.25rem",
    fontWeight: 700,
    letterSpacing: "0.02em",
    color: "#f5f5f5",
  },
  body: {
    margin: "0 0 28px",
    fontSize: "0.9rem",
    lineHeight: 1.65,
    color: "#9ca3af",
  },
  highlight: {
    color: "#f59e0b",
    fontWeight: 600,
  },
  actions: {
    display: "flex",
    gap: "12px",
    justifyContent: "center",
  },
  cancelBtn: {
    flex: 1,
    padding: "11px 20px",
    fontSize: "0.85rem",
    fontWeight: 600,
    letterSpacing: "0.03em",
    textTransform: "uppercase" as const,
    color: "#d1d5db",
    background: "rgba(255, 255, 255, 0.06)",
    border: "1px solid rgba(255, 255, 255, 0.12)",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.15s ease",
  },
  confirmBtn: {
    flex: 1,
    padding: "11px 20px",
    fontSize: "0.85rem",
    fontWeight: 600,
    letterSpacing: "0.03em",
    textTransform: "uppercase" as const,
    color: "#000",
    background: "linear-gradient(135deg, #f59e0b, #ef4444)",
    border: "none",
    borderRadius: "10px",
    cursor: "pointer",
    transition: "all 0.15s ease",
    boxShadow: "0 0 18px rgba(245, 158, 11, 0.3)",
  },
};
