"use client";

import React, { useState } from "react";
import { isShareCancel, performMomentShare } from "../../lib/momentShare";
import {
  collectedMomentShareUrl,
  dropShareUrl,
  type CollectibleShareTrigger,
  type ShareChannel,
} from "../../lib/collectibleShare";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";
import { useToast } from "../ui/Toast";

/**
 * Share a collectible moment or a drop (#1477 slice 2, #1917). Uses the Web
 * Share sheet where available, falling back to clipboard copy with a toast,
 * and can offer an X post with budget-fitted copy (`xText`). Every link is
 * tagged `utm_campaign=collectible_share`.
 *
 * Emits `punchline.moment_shared` with compact ids only: `{ momentId, dropId,
 * context, method, trigger }`. `trigger` says why the share was offered:
 * `after_collect` (an edition the fan collected) or `drop_page` (an invitation
 * to collect). The shared link's `drop_viewed(source:"share")` closes the #489
 * funnel.
 *
 * Link target: with `momentId`, the moment permalink (`?c=<collectibleId>`
 * upgrades it to the consent-gated edition-pride view); without one, the drop
 * on its release page (`releaseId`).
 */
export interface MomentShareButtonProps {
  /** The moment permalink to share. Omit for a drop-level share. */
  momentId?: string | null;
  dropId: string;
  /** The fan's edition (edition context → `?c=…` pride view). */
  collectibleId?: string | null;
  /** Release hosting the drop; used for a drop-level share (no `momentId`). */
  releaseId?: string | null;
  context: "inventory" | "collect_module" | "drop_share" | "permalink";
  trigger?: CollectibleShareTrigger;
  /** Native share-sheet title + body. */
  shareTitle: string;
  shareText: string;
  /** X post text (already fitted to the 280 budget). Renders a "Post on X" link. */
  xText?: string | null;
  className?: string;
  label?: string;
}

export type MomentShareMethod = "web_share" | "clipboard" | "x";

/** The attributable link for a channel, or null when nothing can be linked. */
export function momentShareLink(
  props: Pick<MomentShareButtonProps, "momentId" | "collectibleId" | "releaseId">,
  channel: ShareChannel,
): string | null {
  if (props.momentId) {
    return collectedMomentShareUrl(props.momentId, props.collectibleId, channel);
  }
  if (props.releaseId) return dropShareUrl(props.releaseId, channel);
  return null;
}

/** X intent URL for a fitted post text and a link. */
export function xIntentUrl(text: string, url: string): string {
  return `https://x.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
}

export function MomentShareButton({
  momentId,
  dropId,
  collectibleId,
  releaseId,
  context,
  trigger,
  shareTitle,
  shareText,
  xText,
  className,
  label,
}: MomentShareButtonProps) {
  const { addToast } = useToast();
  const [busy, setBusy] = useState(false);
  const linkProps = { momentId, collectibleId, releaseId };

  const record = (method: MomentShareMethod) => {
    recordProductAnalyticsFromBrowser("punchline.moment_shared", {
      payload: {
        momentId: momentId ?? null,
        dropId,
        context,
        method,
        ...(trigger ? { trigger } : {}),
      },
    });
  };

  const onShare = async () => {
    if (busy) return;
    const url = momentShareLink(linkProps, "native");
    if (!url) return;
    setBusy(true);
    try {
      const method = await performMomentShare({
        url,
        copyUrl: momentShareLink(linkProps, "copy") ?? url,
        title: shareTitle,
        text: shareText,
      });
      if (method === "clipboard") {
        addToast({
          type: "success",
          title: "Link copied",
          message: "Share link copied to your clipboard.",
        });
      }
      record(method);
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

  const xUrl = xText ? momentShareLink(linkProps, "x") : null;

  return (
    <>
      <button
        type="button"
        className={className ?? "punchline-btn-secondary"}
        onClick={onShare}
        disabled={busy}
        aria-disabled={busy}
      >
        {label ?? "Share"}
      </button>
      {xText && xUrl ? (
        <a
          className="punchline-btn-secondary punchline-share-x"
          href={xIntentUrl(xText, xUrl)}
          target="_blank"
          rel="noreferrer"
          title="Post on X"
          aria-label="Post on X"
          onClick={() => record("x")}
        >
          𝕏
        </a>
      ) : null}
    </>
  );
}

export default MomentShareButton;
