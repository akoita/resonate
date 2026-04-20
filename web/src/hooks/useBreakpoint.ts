"use client";

import { useSyncExternalStore } from "react";

/*
 * Canonical breakpoints — mirror the values documented in
 * web/src/styles/tokens.css. Phone <768, tablet 768–1279, desktop ≥1280.
 */
const PHONE_MAX = 767;
const TABLET_MAX = 1279;

export type Breakpoint = "phone" | "tablet" | "desktop";

export interface BreakpointState {
  breakpoint: Breakpoint;
  isPhone: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  /** True for phone-and-below — matches `@media (max-width: 767px)`. */
  isBelowTablet: boolean;
  /** True for tablet-and-above — matches `@media (min-width: 768px)`. */
  isTabletUp: boolean;
}

function subscribe(callback: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const phone = window.matchMedia(`(max-width: ${PHONE_MAX}px)`);
  const tablet = window.matchMedia(`(min-width: ${PHONE_MAX + 1}px) and (max-width: ${TABLET_MAX}px)`);
  phone.addEventListener("change", callback);
  tablet.addEventListener("change", callback);
  return () => {
    phone.removeEventListener("change", callback);
    tablet.removeEventListener("change", callback);
  };
}

function readBreakpoint(): Breakpoint {
  if (typeof window === "undefined") return "desktop";
  if (window.matchMedia(`(max-width: ${PHONE_MAX}px)`).matches) return "phone";
  if (window.matchMedia(`(max-width: ${TABLET_MAX}px)`).matches) return "tablet";
  return "desktop";
}

function getServerSnapshot(): Breakpoint {
  return "desktop";
}

export function useBreakpoint(): BreakpointState {
  const breakpoint = useSyncExternalStore(subscribe, readBreakpoint, getServerSnapshot);
  const isPhone = breakpoint === "phone";
  const isTablet = breakpoint === "tablet";
  const isDesktop = breakpoint === "desktop";
  return {
    breakpoint,
    isPhone,
    isTablet,
    isDesktop,
    isBelowTablet: isPhone,
    isTabletUp: !isPhone,
  };
}
