"use client";

import { useCallback, useEffect, useState, type RefObject } from "react";

export interface ImmersiveModeState {
  active: boolean;
  fullscreen: boolean;
  fallback: boolean;
  enter: () => Promise<void>;
  exit: () => Promise<void>;
  toggle: () => Promise<void>;
}

/**
 * Keeps native fullscreen and the in-page immersive fallback behind one API.
 */
export function useImmersiveMode(
  elementRef: RefObject<HTMLElement | null>,
): ImmersiveModeState {
  const [fullscreen, setFullscreen] = useState(false);
  const [fallback, setFallback] = useState(false);

  useEffect(() => {
    if (typeof document === "undefined") return;

    const handleFullscreenChange = () => {
      const fullscreenElement = document.fullscreenElement;
      setFullscreen(fullscreenElement === elementRef.current);

      // Native and in-page immersive modes are mutually exclusive.
      if (fullscreenElement) setFallback(false);
    };

    document.addEventListener("fullscreenchange", handleFullscreenChange);
    handleFullscreenChange();

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    };
  }, [elementRef]);

  const enter = useCallback(async () => {
    const element = elementRef.current;

    if (typeof document === "undefined" || !element?.requestFullscreen) {
      setFullscreen(false);
      setFallback(true);
      return;
    }

    try {
      await element.requestFullscreen();
      setFullscreen(document.fullscreenElement === element);
      setFallback(false);
    } catch {
      setFullscreen(false);
      setFallback(true);
    }
  }, [elementRef]);

  const exit = useCallback(async () => {
    setFallback(false);

    if (typeof document === "undefined") {
      setFullscreen(false);
      return;
    }

    if (
      document.fullscreenElement === elementRef.current &&
      typeof document.exitFullscreen === "function"
    ) {
      try {
        await document.exitFullscreen();
      } catch {
        // Keep state aligned with the browser if it refuses to exit.
      }
    }

    setFullscreen(document.fullscreenElement === elementRef.current);
  }, [elementRef]);

  const active = fullscreen || fallback;
  useEffect(() => {
    if (!active || typeof document === "undefined") return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") void exit();
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [active, exit]);

  const toggle = useCallback(async () => {
    if (active) await exit();
    else await enter();
  }, [active, enter, exit]);

  return { active, fullscreen, fallback, enter, exit, toggle };
}
