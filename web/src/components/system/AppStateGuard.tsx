"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { AUTH_INVALIDATED_EVENT, resetLocalAppState } from "../../lib/authSession";
import {
  classifyEnvironmentChange,
  fetchAppEnvironment,
  getStoredEnvironmentStamp,
  storeEnvironmentStamp,
  type AppEnvironmentStamp,
  type EnvironmentChange,
} from "../../lib/appEnvironment";
import { SessionResetDialog } from "./SessionResetDialog";

/**
 * Detects backend version/environment change and guides the user (#1199):
 *   - environment_changed → guided session-reset dialog
 *   - version_skew        → non-destructive "reload to update" banner
 *
 * Detection runs on mount, on window focus, and after an auth-invalidation
 * event (a 401 against a new environment), so a returning user is told what
 * happened instead of hitting silent failures. A failed /health is treated as
 * "no change" — never as a reset trigger.
 */
export function AppStateGuard() {
  const { disconnect } = useAuth();
  const [change, setChange] = useState<EnvironmentChange>("none");
  const currentRef = useRef<AppEnvironmentStamp | null>(null);
  const checkingRef = useRef(false);

  const runCheck = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    try {
      const current = await fetchAppEnvironment();
      if (!current) return; // unreachable health = no change, never nag
      currentRef.current = current;
      const stored = getStoredEnvironmentStamp();
      if (!stored) {
        // First run on this browser: adopt the stamp silently.
        storeEnvironmentStamp(current);
        return;
      }
      setChange(classifyEnvironmentChange(stored, current));
    } finally {
      checkingRef.current = false;
    }
  }, []);

  useEffect(() => {
    void runCheck();
    const onFocus = () => void runCheck();
    const onAuthInvalidated = () => void runCheck();
    window.addEventListener("focus", onFocus);
    window.addEventListener(AUTH_INVALIDATED_EVENT, onAuthInvalidated);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener(AUTH_INVALIDATED_EVENT, onAuthInvalidated);
    };
  }, [runCheck]);

  const adoptCurrentStamp = () => {
    if (currentRef.current) storeEnvironmentStamp(currentRef.current);
  };

  const handleReset = async () => {
    resetLocalAppState();
    try {
      disconnect();
    } catch {
      // disconnect best-effort; the storage clear is what matters.
    }
    adoptCurrentStamp(); // don't re-prompt for the same environment post-reset
    window.location.reload();
  };

  const handleReloadForUpdate = () => {
    adoptCurrentStamp(); // new bundle will match; don't loop the banner
    window.location.reload();
  };

  if (change === "environment_changed") {
    return (
      <SessionResetDialog
        isOpen
        onReset={handleReset}
        onDismiss={() => setChange("none")}
      />
    );
  }

  if (change === "version_skew") {
    return (
      <div
        role="status"
        className="fixed inset-x-0 top-0 z-[900] flex items-center justify-center gap-3 bg-purple-600/95 px-4 py-2 text-sm text-white shadow-md"
      >
        <span>A new version of Resonate is available.</span>
        <button
          type="button"
          className="rounded-md bg-white/20 px-3 py-1 font-medium hover:bg-white/30"
          onClick={handleReloadForUpdate}
        >
          Reload
        </button>
        <button
          type="button"
          aria-label="Dismiss update notice"
          className="text-white/70 hover:text-white"
          onClick={() => setChange("none")}
        >
          ✕
        </button>
      </div>
    );
  }

  return null;
}
