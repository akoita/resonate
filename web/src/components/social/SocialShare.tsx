"use client";

import { useMemo, useState, useEffect } from "react";
import {
  listeningShareMessage,
  listeningShareUrl,
  type ShareChannel,
  type ShareableTrack,
} from "../../lib/listeningShare";
import { recordProductAnalyticsFromBrowser } from "../../lib/productAnalytics";

type SocialShareProps = {
  track: ShareableTrack;
};

export default function SocialShare({ track }: SocialShareProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
    setIsMounted(true);
  }, []);

  const origin = isMounted ? window.location.origin : "";
  const isShareable = !!listeningShareUrl("", track, "copy");

  const links = useMemo(() => {
    if (!isMounted || !isShareable) return null;
    const url = (channel: ShareChannel) => listeningShareUrl(origin, track, channel) ?? "";
    const x = listeningShareMessage(track, "x");
    const reddit = listeningShareMessage(track, "reddit");
    return {
      x: `https://x.com/intent/tweet?text=${encodeURIComponent(x.text)}&url=${encodeURIComponent(url("x"))}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url("facebook"))}`,
      reddit: `https://www.reddit.com/submit?title=${encodeURIComponent(reddit.title)}&url=${encodeURIComponent(url("reddit"))}`,
      copy: url("copy"),
      native: url("native"),
    };
  }, [isMounted, isShareable, origin, track]);

  const recordShare = (channel: ShareChannel) => {
    const trackId = track.catalogTrackId ?? track.trackId ?? undefined;
    recordProductAnalyticsFromBrowser("track.shared", {
      source: "player",
      subjectType: trackId ? "track" : undefined,
      subjectId: trackId,
      payload: { channel, releaseId: track.releaseId ?? undefined, trackId },
    });
  };

  if (!isShareable) {
    return (
      <div className="share-actions-container">
        <p style={{ margin: 0, fontSize: "12px", color: "var(--color-muted)" }}>
          Sharing is available for tracks published on Resonate.
        </p>
      </div>
    );
  }

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
      setStatus("Sharing not supported.");
      return;
    }
    const message = listeningShareMessage(track, "native");
    try {
      await navigator.share({ title: message.title, text: message.text, url: links.native });
      setStatus("Shared.");
      recordShare("native");
    } catch {
      setStatus("Share cancelled.");
    }
  };

  return (
    <div className="share-actions-container">
      <div className="share-action-row">
        {/* Native Share / General Share Icon */}
        <button type="button" className="share-icon-btn" onClick={nativeShare} title="Share" aria-label="Share">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>

        {/* X / Twitter Icon */}
        <a className="share-icon-btn" href={links?.x} target="_blank" rel="noreferrer" title="Share on X" aria-label="Share on X" onClick={() => recordShare("x")}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>

        {/* Facebook Icon */}
        <a className="share-icon-btn" href={links?.facebook} target="_blank" rel="noreferrer" title="Share on Facebook" aria-label="Share on Facebook" onClick={() => recordShare("facebook")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
          </svg>
        </a>

        {/* Reddit Icon */}
        <a className="share-icon-btn" href={links?.reddit} target="_blank" rel="noreferrer" title="Share on Reddit" aria-label="Share on Reddit" onClick={() => recordShare("reddit")}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </a>

        {/* Copy Link Icon */}
        <button type="button" className="share-icon-btn" onClick={copyLink} title="Copy link" aria-label="Copy link">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
            <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
          </svg>
        </button>
      </div>
      {status ? (
        <div style={{ fontSize: "10px", color: "var(--color-accent)", marginTop: "8px", fontWeight: 700, letterSpacing: "0.05em", textTransform: "uppercase" }}>
          {status}
        </div>
      ) : null}
    </div>
  );
}
