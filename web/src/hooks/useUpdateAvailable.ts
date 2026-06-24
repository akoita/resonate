"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { BUILD_VERSION } from "../lib/buildVersion";
import { DEV_BUILD_VERSION, isUpdateAvailable } from "../lib/updateAvailable";

const POLL_INTERVAL_MS = 60_000;

async function fetchDeployedVersion(signal?: AbortSignal): Promise<string | null> {
  try {
    const res = await fetch("/api/version", { cache: "no-store", signal });
    if (!res.ok) return null;
    const data = (await res.json()) as { version?: unknown };
    return typeof data.version === "string" ? data.version : null;
  } catch {
    return null;
  }
}

export type UpdateAvailableState = {
  updateAvailable: boolean;
  deployedVersion: string | null;
  reload: () => void;
};

/**
 * Polls the server's deployed build version and reports when it differs from
 * the build this client is running — i.e. a new deployment is live and the user
 * should refresh. Disabled for unbuilt/dev runs. Re-checks on a timer, on tab
 * focus, and when the connection comes back online.
 */
export function useUpdateAvailable(): UpdateAvailableState {
  const [deployedVersion, setDeployedVersion] = useState<string | null>(null);
  const mountedRef = useRef(false);

  const check = useCallback(async (signal?: AbortSignal) => {
    const version = await fetchDeployedVersion(signal);
    if (version && mountedRef.current) setDeployedVersion(version);
  }, []);

  useEffect(() => {
    // Never poll for an unbuilt/dev bundle — there is no real deployed version
    // to compare against and we must not nag local developers.
    if (BUILD_VERSION === DEV_BUILD_VERSION) return;

    mountedRef.current = true;
    const controller = new AbortController();
    void check(controller.signal);

    const interval = window.setInterval(() => void check(controller.signal), POLL_INTERVAL_MS);
    const recheck = () => {
      if (document.visibilityState === "visible") void check(controller.signal);
    };
    document.addEventListener("visibilitychange", recheck);
    window.addEventListener("online", recheck);

    return () => {
      mountedRef.current = false;
      controller.abort();
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", recheck);
      window.removeEventListener("online", recheck);
    };
  }, [check]);

  const reload = useCallback(() => {
    window.location.reload();
  }, []);

  return {
    updateAvailable: isUpdateAvailable(BUILD_VERSION, deployedVersion),
    deployedVersion,
    reload,
  };
}
