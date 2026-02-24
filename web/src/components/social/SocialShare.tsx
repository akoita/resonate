"use client";

import { useMemo, useState, useEffect } from "react";

type SocialShareProps = {
  title: string;
  artist?: string;
  url?: string;
};

export default function SocialShare({ title, artist, url }: SocialShareProps) {
  const [status, setStatus] = useState<string | null>(null);
  const [isMounted, setIsMounted] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- SSR hydration guard
    setIsMounted(true);
     
  }, []);

  const shareUrl = useMemo(() => {
    if (url) return url;
    if (!isMounted) return "";
    return window.location.href;
  }, [url, isMounted]);

  const text = artist ? `${title} — ${artist}` : title;

  const links = useMemo(
    () => ({
      x: `https://x.com/intent/tweet?text=${encodeURIComponent(
        text
      )}&url=${encodeURIComponent(shareUrl)}`,
      facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(
        shareUrl
      )}`,
      reddit: `https://www.reddit.com/submit?title=${encodeURIComponent(
        text
      )}&url=${encodeURIComponent(shareUrl)}`,
    }),
    [shareUrl, text]
  );

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(shareUrl);
      setStatus("Link copied.");
    } catch {
      setStatus("Copy failed.");
    }
  };

  const nativeShare = async () => {
    if (!navigator.share) {
      setStatus("Sharing not supported.");
      return;
    }
    try {
      await navigator.share({ title: text, text, url: shareUrl });
      setStatus("Shared.");
    } catch {
      setStatus("Share cancelled.");
    }
  };

  return (
    <div className="share-actions-container">
      <div className="share-action-row">
        {/* Native Share / General Share Icon */}
        <button className="share-icon-btn" onClick={nativeShare} title="Share">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
            <polyline points="16 6 12 2 8 6" />
            <line x1="12" y1="2" x2="12" y2="15" />
          </svg>
        </button>

        {/* X / Twitter Icon */}
        <a className="share-icon-btn" href={links.x} target="_blank" rel="noreferrer" title="Share on X">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
          </svg>
        </a>

        {/* Facebook Icon */}
        <a className="share-icon-btn" href={links.facebook} target="_blank" rel="noreferrer" title="Share on Facebook">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />
          </svg>
        </a>

        {/* Reddit Icon */}
        <a className="share-icon-btn" href={links.reddit} target="_blank" rel="noreferrer" title="Share on Reddit">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
        </a>

        {/* Copy Link Icon */}
        <button className="share-icon-btn" onClick={copyLink} title="Copy link">
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
