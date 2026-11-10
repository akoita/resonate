"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { runWhenSettledAndIdle } from "../../lib/pageSettle";

/** Start a deferred widget this far before it scrolls into view. */
const NEAR_VIEWPORT_MARGIN = "800px 0px";

/**
 * Mounts `children` later than the rest of the page, showing `fallback` (a
 * placeholder of the same size) until then.
 *
 * For self-contained widgets below the first screen that fetch their own data
 * (the Home Drops shelf, the AI DJ panel). Mounted with the page, each one
 * adds its requests, its render and its images to the busiest second the page
 * has, for content nobody can see yet. Deferred, it starts at the first of:
 *
 * - the page has settled after loading and the browser is idle (widgets start
 *   one per idle period, in document order), normally 2–3 s after opening;
 * - it comes within 800px of the viewport, so scrolling never outruns it;
 * - the URL has a #hash, because an anchored load needs the real layout now.
 *
 * Nobody waits longer for it than a scroll to it takes, and what they see
 * until then is the same placeholder the widget already showed while its own
 * code and data loaded.
 *
 * The sentinel is a zero-height block placed before the fallback rather than
 * a wrapper around it, so the fallback stays a direct child of its parent and
 * parent > child layout rules keep applying to it.
 */
export function DeferredMount({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [ready, setReady] = useState(false);
  const sentinel = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (ready) return;
    const mount = () => setReady(true);
    if (window.location.hash) {
      mount();
      return;
    }
    const cancelIdle = runWhenSettledAndIdle(mount);
    let observer: IntersectionObserver | undefined;
    if (typeof IntersectionObserver !== "undefined" && sentinel.current) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries.some((entry) => entry.isIntersecting)) mount();
        },
        { rootMargin: NEAR_VIEWPORT_MARGIN },
      );
      observer.observe(sentinel.current);
    }
    return () => {
      cancelIdle();
      observer?.disconnect();
    };
  }, [ready]);

  if (ready) return <>{children}</>;
  return (
    <>
      <span ref={sentinel} data-deferred-mount="" aria-hidden="true" style={{ display: "block", height: 0 }} />
      {fallback}
    </>
  );
}
