"use client";

import { useMemo, useState } from "react";
import { Button } from "../ui/Button";

type SocialShareProps = {
  title: string;
  artist?: string;
  url?: string;
};

export default function SocialShare({ title, artist, url }: SocialShareProps) {
  const [status, setStatus] = useState<string | null>(null);
  const shareUrl =
    url ?? (typeof window !== "undefined" ? window.location.href : "");
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
    <div className="share-panel">
      <div className="share-title">Share this track</div>
      <div className="share-row">
        <Button variant="ghost" onClick={nativeShare}>
          Share
        </Button>
        <a className="share-link" href={links.x} target="_blank" rel="noreferrer">
          X
        </a>
        <a
          className="share-link"
          href={links.facebook}
          target="_blank"
          rel="noreferrer"
        >
          Facebook
        </a>
        <a
          className="share-link"
          href={links.reddit}
          target="_blank"
          rel="noreferrer"
        >
          Reddit
        </a>
        <Button variant="ghost" onClick={copyLink}>
          Copy link
        </Button>
      </div>
      {status ? <div className="queue-meta">{status}</div> : null}
    </div>
  );
}
