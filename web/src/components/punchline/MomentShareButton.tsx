"use client";

import React, { useState } from "react";
import {
  buildMomentShareUrl,
  isShareCancel,
  performMomentShare,
} from "../../lib/momentShare";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";
import { useToast } from "../ui/Toast";

/**
 * Share a collectible moment (#1477 slice 2). Uses the Web Share sheet where
 * available, falling back to clipboard copy with a toast. Emits
 * `punchline.moment_shared` with the method used so shares are attributable in
 * the #489 funnel (the shared link's `drop_viewed(source:"share")` closes it).
 *
 * Inventory passes the `collectibleId` (edition context → `?c=…` pride view);
 * the release collect module shares the plain moment link.
 */
export interface MomentShareButtonProps {
  momentId: string;
  dropId: string;
  /** Present only from the inventory (edition context). */
  collectibleId?: string | null;
  context: "inventory" | "collect_module";
  /** Native share-sheet title + body. */
  shareTitle: string;
  shareText: string;
  className?: string;
  label?: string;
}

export function MomentShareButton({
  momentId,
  dropId,
  collectibleId,
  context,
  shareTitle,
  shareText,
  className,
  label,
}: MomentShareButtonProps) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);

  const onShare = async () => {
    if (busy) return;
    setBusy(true);
    const url = buildMomentShareUrl(momentId, collectibleId);
    try {
      const method = await performMomentShare({ url, title: shareTitle, text: shareText });
      if (method === "clipboard") {
        addToast({
          type: "success",
          title: "Link copied",
          message: "Share link copied to your clipboard.",
        });
      }
      recordProductAnalyticsFromBrowser("punchline.moment_shared", {
        payload: { momentId, dropId, context, method },
      });
    } catch (error) {
      // A cancelled native share sheet is a no-op, not an error.
      if (!isShareCancel(error)) {
        addToast({
          type: "error",
          title: "Couldn’t share",
          message: "Copy the link from your browser instead.",
        });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={className ?? "punchline-btn-secondary"}
      onClick={onShare}
      disabled={busy}
      aria-disabled={busy}
    >
      {label ?? "Share"}
    </button>
  );
}

export default MomentShareButton;
