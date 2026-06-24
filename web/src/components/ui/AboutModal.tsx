"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import {
  APP_NAME,
  APP_TAGLINE,
  APP_VERSION,
  BUILDER_HANDLE,
  BUILDER_URL,
  COMMIT_SHA,
  ISSUES_URL,
  REPO_URL,
  getCommitUrl,
  getEnvironment,
  isProduction,
} from "../../lib/buildInfo";

interface AboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

// Glass surface mirrors design.md §Elevation "Floating layer" — same
// 12% white fill + 64px blur + primary-tinted glow used by ConfirmDialog
// so the About sheet visually belongs to the same layer.
export function AboutModal({ isOpen, onClose }: AboutModalProps) {
  const [mounted, setMounted] = useState(false);
  const [animating, setAnimating] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- trigger enter animation
    if (isOpen) setAnimating(true);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onClose]);

  if (!isOpen || !mounted) return null;

  const env = getEnvironment();
  const showEnvBadge = !isProduction();
  const commitUrl = getCommitUrl();

  const sheet = (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.75)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 9999,
        opacity: animating ? 1 : 0,
        transition: "opacity 0.2s ease-out",
        padding: "24px",
      }}
      onClick={onClose}
    >
      <style>{`
        @keyframes about-modal-enter {
          from { opacity: 0; transform: scale(0.96) translateY(8px); }
          to { opacity: 1; transform: scale(1) translateY(0); }
        }
        .about-row {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          padding: 10px 0;
        }
        .about-row + .about-row {
          border-top: 1px solid rgba(255, 255, 255, 0.06);
        }
        .about-label {
          font-size: 12px;
          color: var(--ds-on-surface-variant, #cdc2d8);
          letter-spacing: 0.04em;
          text-transform: uppercase;
        }
        .about-value {
          font-size: 13px;
          color: #fff;
          font-variant-numeric: tabular-nums;
          font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
        }
        .about-link {
          color: var(--ds-primary, #d4bbff);
          text-decoration: none;
          font-size: 13px;
          transition: color 0.15s ease;
        }
        .about-link:hover {
          color: #fff;
          text-decoration: underline;
        }
        .about-close-btn {
          width: 100%;
          padding: 12px 24px;
          border-radius: 12px;
          border: 1px solid rgba(255, 255, 255, 0.10);
          background: rgba(255, 255, 255, 0.04);
          color: rgba(255, 255, 255, 0.85);
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
          transition: all 0.2s ease;
          font-family: inherit;
        }
        .about-close-btn:hover {
          background: rgba(255, 255, 255, 0.08);
          border-color: rgba(255, 255, 255, 0.18);
          color: #fff;
        }
      `}</style>

      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="about-modal-title"
        onClick={(e) => e.stopPropagation()}
        style={{
          maxWidth: "440px",
          width: "100%",
          background: "rgba(255, 255, 255, 0.12)",
          backdropFilter: "blur(64px) saturate(140%)",
          WebkitBackdropFilter: "blur(64px) saturate(140%)",
          border: "1px solid rgba(212, 187, 255, 0.20)",
          borderRadius: "20px",
          boxShadow: `
            0 24px 80px rgba(0, 0, 0, 0.6),
            0 0 0 1px rgba(255, 255, 255, 0.04),
            0 0 60px rgba(138, 63, 252, 0.18)
          `,
          overflow: "hidden",
          animation: "about-modal-enter 0.35s cubic-bezier(0.16, 1, 0.3, 1)",
        }}
      >
        <div
          style={{
            height: "2px",
            background:
              "linear-gradient(90deg, transparent, #d4bbff, transparent)",
            opacity: 0.6,
          }}
        />

        <div
          style={{
            padding: "32px 28px 20px",
            display: "flex",
            flexDirection: "column",
            gap: "20px",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 32, lineHeight: 1 }}>✨</span>
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              <h2
                id="about-modal-title"
                style={{
                  margin: 0,
                  fontSize: 22,
                  fontWeight: 700,
                  letterSpacing: "-0.02em",
                  fontFamily:
                    'var(--ds-font-display, "Space Grotesk", system-ui, sans-serif)',
                  color: "#fff",
                }}
              >
                {APP_NAME}
              </h2>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  flexWrap: "wrap",
                }}
              >
                {APP_VERSION ? (
                  <span
                    style={{
                      fontSize: 12,
                      color: "rgba(255,255,255,0.55)",
                      fontFamily:
                        "ui-monospace, SFMono-Regular, Menlo, monospace",
                    }}
                  >
                    v{APP_VERSION}
                  </span>
                ) : null}
                {showEnvBadge ? (
                  <span
                    style={{
                      fontSize: 10,
                      fontWeight: 700,
                      letterSpacing: "0.08em",
                      textTransform: "uppercase",
                      padding: "2px 8px",
                      borderRadius: 999,
                      background: "rgba(255, 183, 130, 0.15)",
                      color: "#ffb782",
                      border: "1px solid rgba(255, 183, 130, 0.30)",
                    }}
                  >
                    {env}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <p
            style={{
              margin: 0,
              fontSize: 13.5,
              lineHeight: 1.6,
              color: "rgba(255, 255, 255, 0.65)",
            }}
          >
            {APP_TAGLINE}
          </p>

          <div style={{ display: "flex", flexDirection: "column" }}>
            <div className="about-row">
              <span className="about-label">User guide</span>
              <Link className="about-link" href="/help" onClick={onClose}>
                Learn how to use Resonate →
              </Link>
            </div>
            <div className="about-row">
              <span className="about-label">Source</span>
              <a
                className="about-link"
                href={REPO_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                github.com/akoita/resonate ↗
              </a>
            </div>
            <div className="about-row">
              <span className="about-label">Built by</span>
              <a
                className="about-link"
                href={BUILDER_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                @{BUILDER_HANDLE} ↗
              </a>
            </div>
            <div className="about-row">
              <span className="about-label">Issues</span>
              <a
                className="about-link"
                href={ISSUES_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Report a bug ↗
              </a>
            </div>
            {COMMIT_SHA ? (
              <div className="about-row">
                <span className="about-label">Build</span>
                {commitUrl ? (
                  <a
                    className="about-link about-value"
                    href={commitUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {COMMIT_SHA} ↗
                  </a>
                ) : (
                  <span className="about-value">{COMMIT_SHA}</span>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <div
          style={{
            height: 1,
            background:
              "linear-gradient(90deg, transparent, rgba(255,255,255,0.06), transparent)",
            margin: "0 24px",
          }}
        />

        <div style={{ padding: "20px 24px 24px" }}>
          <button
            type="button"
            className="about-close-btn"
            onClick={onClose}
            autoFocus
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(sheet, document.body);
}
