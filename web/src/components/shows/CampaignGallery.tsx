"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";

export type CampaignGalleryVisual = {
  id: string;
  url: string;
  caption?: string | null;
};

/**
 * The campaign gallery as an immersive, "activatable" experience: the grid
 * is a gallery wall, and clicking any visual opens a full-screen lightbox
 * with horizontal slideshow navigation (arrows, keyboard ←/→/Esc, a
 * thumbnail filmstrip, and a counter) so a promo page can actually immerse
 * the visitor.
 */
export function CampaignGallery({ visuals }: { visuals: CampaignGalleryVisual[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const isOpen = openIndex !== null;

  const close = useCallback(() => setOpenIndex(null), []);
  const go = useCallback(
    (dir: number) => {
      setOpenIndex((current) => {
        if (current === null) return current;
        const count = visuals.length;
        return (current + dir + count) % count;
      });
    },
    [visuals.length],
  );

  useEffect(() => {
    if (!isOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
      else if (event.key === "ArrowRight") go(1);
      else if (event.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      window.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen, close, go]);

  const active = openIndex !== null ? visuals[openIndex] : null;

  return (
    <>
      <div className="show-detail__visual-story">
        {visuals.map((visual, index) => (
          <figure
            key={visual.id}
            className={`show-detail__visual-frame show-detail__visual-frame--${index + 1}`}
          >
            <button
              type="button"
              className="show-detail__visual-open"
              onClick={() => setOpenIndex(index)}
              aria-label={visual.caption ? `Open: ${visual.caption}` : `Open image ${index + 1}`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- campaign visuals are dynamic backend media. */}
              <img src={visual.url} alt="" loading="lazy" />
              <span className="show-detail__visual-zoom" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 3h6v6" />
                  <path d="M9 21H3v-6" />
                  <path d="M21 3l-7 7" />
                  <path d="M3 21l7-7" />
                </svg>
              </span>
            </button>
            {visual.caption ? <figcaption>{visual.caption}</figcaption> : null}
          </figure>
        ))}
      </div>

      {active && openIndex !== null && typeof document !== "undefined"
        ? createPortal(
        <div
          className="gallery-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label="Campaign gallery"
          onClick={close}
        >
          <button
            type="button"
            className="gallery-lightbox__close"
            onClick={close}
            aria-label="Close gallery"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>

          {visuals.length > 1 ? (
            <button
              type="button"
              className="gallery-lightbox__nav gallery-lightbox__nav--prev"
              onClick={(event) => {
                event.stopPropagation();
                go(-1);
              }}
              aria-label="Previous image"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6" />
              </svg>
            </button>
          ) : null}

          <figure
            className="gallery-lightbox__stage"
            onClick={(event) => event.stopPropagation()}
          >
            {/* eslint-disable-next-line @next/next/no-img-element -- campaign visuals are dynamic backend media. */}
            <img key={active.id} src={active.url} alt={active.caption ?? ""} />
            <figcaption className="gallery-lightbox__caption">
              <span className="gallery-lightbox__counter">
                {openIndex + 1} / {visuals.length}
              </span>
              {active.caption ? <p>{active.caption}</p> : null}
            </figcaption>
          </figure>

          {visuals.length > 1 ? (
            <button
              type="button"
              className="gallery-lightbox__nav gallery-lightbox__nav--next"
              onClick={(event) => {
                event.stopPropagation();
                go(1);
              }}
              aria-label="Next image"
            >
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="9 18 15 12 9 6" />
              </svg>
            </button>
          ) : null}

          {visuals.length > 1 ? (
            <div
              className="gallery-lightbox__filmstrip"
              onClick={(event) => event.stopPropagation()}
            >
              {visuals.map((visual, index) => (
                <button
                  key={visual.id}
                  type="button"
                  className={`gallery-lightbox__thumb ${index === openIndex ? "is-active" : ""}`}
                  onClick={() => setOpenIndex(index)}
                  aria-label={`Go to image ${index + 1}`}
                  aria-current={index === openIndex || undefined}
                >
                  {/* eslint-disable-next-line @next/next/no-img-element -- campaign visuals are dynamic backend media. */}
                  <img src={visual.url} alt="" loading="lazy" />
                </button>
              ))}
            </div>
          ) : null}
        </div>,
        document.body,
      )
        : null}
    </>
  );
}
