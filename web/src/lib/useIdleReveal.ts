"use client";

import { useEffect, useRef, useState } from "react";

const WAKE_EVENTS = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"] as const;

/**
 * Reports when the viewer has stopped interacting, so a surface can quietly
 * step out of the way — the convention every full-screen video player uses.
 *
 * Returns false whenever `enabled` is false, and resets as `enabled` flips, so
 * re-entering never resumes mid-fade from the previous session.
 */
export function useIdleReveal(enabled: boolean, delayMs = 2600): boolean {
  const [idle, setIdle] = useState(false);
  const [lastEnabled, setLastEnabled] = useState(enabled);
  const idleRef = useRef(false);

  /* Adjusting state during render (React's documented alternative to an
   * effect for prop-derived resets): waiting for an effect would let one
   * frame paint with the previous session's idle state still applied. */
  let settled = idle;
  if (lastEnabled !== enabled) {
    setLastEnabled(enabled);
    setIdle(false);
    // idleRef is deliberately untouched: refs must not be written during
    // render, and the effect's opening wake() reconciles it either way.
    settled = false;
  }

  useEffect(() => {
    if (!enabled) return;

    let timer: ReturnType<typeof setTimeout> | undefined;

    const goIdle = () => {
      idleRef.current = true;
      setIdle(true);
    };

    const wake = () => {
      if (timer) clearTimeout(timer);
      // Only re-render on a real transition; pointermove fires constantly.
      if (idleRef.current) {
        idleRef.current = false;
        setIdle(false);
      }
      timer = setTimeout(goIdle, delayMs);
    };

    wake();
    for (const event of WAKE_EVENTS) {
      window.addEventListener(event, wake, { passive: true });
    }

    return () => {
      if (timer) clearTimeout(timer);
      for (const event of WAKE_EVENTS) {
        window.removeEventListener(event, wake);
      }
    };
  }, [enabled, delayMs]);

  return enabled && settled;
}
