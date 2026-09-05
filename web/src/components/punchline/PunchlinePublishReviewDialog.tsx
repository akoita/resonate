"use client";

import React, { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type { PunchlineDrop } from "../../lib/api";
import { formatClipDuration } from "./PunchlineClipSelector";
import {
  formatEditionLabel,
  formatPriceCents,
  totalEditions,
} from "./punchlineDropHelpers";

/**
 * Publish review step for a Punchline Drop (#484).
 *
 * ConfirmDialog only accepts a plain-string `message`, which can't render the
 * moment list or make the non-commercial rights warning prominent, so this is a
 * small purpose-built modal that follows ConfirmDialog's floating-glass styling.
 * The review body is a pure, exported component so it renders under
 * `renderToStaticMarkup` in tests.
 */

export interface PunchlinePublishReviewContentProps {
  drop: PunchlineDrop;
}

/** Pure review body: what will be published + the rights warning, verbatim. */
export function PunchlinePublishReviewContent({
  drop,
}: PunchlinePublishReviewContentProps) {
  const moments = drop.moments;
  const editions = totalEditions(drop);

  return (
    <div className="punchline-review">
      <p className="punchline-review-summary">
        Publishing <strong>{moments.length}</strong>{" "}
        {moments.length === 1 ? "moment" : "moments"} ·{" "}
        <strong>{editions.toLocaleString()}</strong> total editions.
      </p>

      <ul className="punchline-review-moments">
        {moments.map((moment) => (
          <li key={moment.id} className="punchline-review-moment">
            <span className="punchline-review-moment-title">
              {moment.title}
            </span>
            <span className="punchline-review-moment-meta">
              {formatClipDuration(moment.endMs - moment.startMs)} ·{" "}
              {formatEditionLabel(moment.editionSize)} ·{" "}
              {formatPriceCents(moment.priceCents)}
            </span>
          </li>
        ))}
      </ul>

      <div className="punchline-review-rights" role="note">
        <span className="punchline-review-rights-label">
          {drop.rightsLabel}
        </span>
        <p className="punchline-review-rights-summary">{drop.rightsSummary}</p>
      </div>

      <p className="punchline-review-note">
        Publishing extracts each clip from the vocals stem and makes the drop
        public. Published drops can’t be edited.
      </p>

      <p className="punchline-review-note punchline-review-note-muted">
        {drop.unlock
          ? "🎁 Fans who collect every moment unlock your set bonus."
          : "No set bonus configured — you can add one before publishing."}
      </p>
    </div>
  );
}

export interface PunchlinePublishReviewDialogProps {
  isOpen: boolean;
  drop: PunchlineDrop;
  onConfirm: () => void | Promise<void>;
  onCancel: () => void;
}

const ACCENT = "#a78bfa";

export function PunchlinePublishReviewDialog({
  isOpen,
  drop,
  onConfirm,
  onCancel,
}: PunchlinePublishReviewDialogProps) {
  const [mounted, setMounted] = useState(false);
  const [loading, setLoading] = useState(false);

  // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reset loading when dialog opens
    setLoading(false);
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !loading) onCancel();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [isOpen, onCancel, loading]);

  if (!isOpen || !mounted) return null;

  const dialog = (
    <div
      className="punchline-review-overlay"
      onClick={() => {
        if (!loading) onCancel();
      }}
    >
      <div
        className="punchline-review-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Review and publish Punchline Drop"
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="punchline-review-accent"
          style={{
            background: `linear-gradient(90deg, transparent, ${ACCENT}, transparent)`,
          }}
        />
        <div className="punchline-review-header">
          <h3>Review &amp; publish</h3>
          <p>Confirm the collectible moments before they go live.</p>
        </div>

        <div className="punchline-review-scroll">
          <PunchlinePublishReviewContent drop={drop} />
        </div>

        <div className="punchline-review-actions">
          <button
            type="button"
            className="punchline-review-cancel"
            onClick={onCancel}
            disabled={loading}
          >
            Keep editing
          </button>
          <button
            type="button"
            className="punchline-review-confirm"
            disabled={loading}
            onClick={async () => {
              setLoading(true);
              try {
                await onConfirm();
              } catch {
                setLoading(false);
              }
            }}
          >
            {loading ? "Extracting clips…" : "Publish drop"}
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(dialog, document.body);
}

export default PunchlinePublishReviewDialog;
