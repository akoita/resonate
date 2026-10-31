"use client";

import { useEffect, useMemo, useState } from "react";
import type { ShareChannel } from "../../lib/listeningShare";

export type ActionShareMessage = { title: string; text: string };

type Props = {
  /** Absolute, attributable link for a channel; `origin` is the page origin. */
  shareUrl: (origin: string, channel: ShareChannel) => string;
  /** Tailored copy for a channel (Reddit uses `title`, X and native `text`). */
  message: (channel: ShareChannel) => ActionShareMessage;
  /** Called once a share went out on a channel (record the analytics here). */
  onShared?: (channel: ShareChannel) => void;
  /** Short line above the buttons. */
  label: string;
  /** Exposed as `data-share` so tests and styles can tell the shares apart. */
  kind: string;
  className?: string;
};

/**
 * Offer a tailored share right after a fan action (#1915): X, Facebook,
 * Reddit, the native share sheet, and copy link. The fan chooses to share;
 * nothing is posted automatically. Links and copy join after mount so the
 * server render and hydration match.
 */
export function ActionShare({ shareUrl, message, onShared, label, kind, className }: Props) {
  const [status, setStatus] = useState<string | null>(null);
  const [origin, setOrigin] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
    setOrigin(window.location.origin);
  }, []);

  const links = useMemo(() => {
    if (!origin) return null;
    const url = (channel: ShareChannel) => shareUrl(origin, channel);
    const x = message("x");
    const reddit = message("reddit");
    return {
      x: `https://x.com/intent/tweet?text=${encodeURIComponent(x.text)}&url=${encodeURIComponent(url("x"))}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url("facebook"))}`,
      reddit: `https://www.reddit.com/submit?title=${encodeURIComponent(reddit.title)}&url=${encodeURIComponent(url("reddit"))}`,
      copy: url("copy"),
      native: url("native"),
      nativeMessage: message("native"),
    };
  }, [message, origin, shareUrl]);

  const recordShare = (channel: ShareChannel) => onShared?.(channel);

  const copyLink = async () => {
    if (!links) return;
    try {
      await navigator.clipboard.writeText(links.copy);
      setStatus("Link copied.");
      recordShare("copy");
    } catch {
      setStatus("Copy failed.");
    }
  };

  const nativeShare = async () => {
    if (!links) return;
    if (!navigator.share) {
      setStatus("Sharing not supported. Copy the link instead.");
      return;
    }
    try {
      await navigator.share({ title: links.nativeMessage.title, text: links.nativeMessage.text, url: links.native });
      setStatus("Shared.");
      recordShare("native");
    } catch {
      setStatus("Share cancelled.");
    }
  };

  return (
    <div className={`action-share ${className ?? ""}`.trim()} data-share={kind}>
      <span className="action-share__label">{label}</span>
      <div className="share-action-row action-share__row" inert={!links || undefined}>
        <button type="button" className="share-icon-btn" onClick={nativeShare} title="Share" aria-label="Share">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>
        <a className="share-icon-btn" href={links?.x} target="_blank" rel="noreferrer noopener" title="Share on X" aria-label="Share on X" onClick={() => recordShare("x")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>
        <a className="share-icon-btn" href={links?.facebook} target="_blank" rel="noreferrer noopener" title="Share on Facebook" aria-label="Share on Facebook" onClick={() => recordShare("facebook")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
          </svg>
        </a>
        <a className="share-icon-btn" href={links?.reddit} target="_blank" rel="noreferrer noopener" title="Share on Reddit" aria-label="Share on Reddit" onClick={() => recordShare("reddit")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <ellipse cx="12" cy="14.5" rx="8" ry="5.5" />
            <circle cx="19.5" cy="10.5" r="1.8" />
            <circle cx="4.5" cy="10.5" r="1.8" />
            <path d="M12 9l1.2-5 4.3 1" />
            <circle cx="18.5" cy="5" r="1.4" />
            <circle cx="9" cy="13.5" r="0.9" fill="currentColor" stroke="none" />
            <circle cx="15" cy="13.5" r="0.9" fill="currentColor" stroke="none" />
            <path d="M9.2 16.8c1.7 1.1 3.9 1.1 5.6 0" />
          </svg>
        </a>
        <button type="button" className="share-icon-btn" onClick={copyLink} title="Copy link" aria-label="Copy link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>
      </div>
      {status ? (
        <p className="action-share__status" role="status">
          {status}
        </p>
      ) : null}
    </div>
  );
}

export default ActionShare;
