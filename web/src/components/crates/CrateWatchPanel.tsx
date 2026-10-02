"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { setCrateWatch } from "../../lib/api";
import { DEFAULT_WATCH_DAYS, watchAvailability } from "../../lib/crateWatch";
import {
  crateErrorMessage,
  type CrateEntitlements,
  type CrateWatch,
} from "../../lib/crates";
import { CrateWatchView } from "./CrateWatchView";

export type CrateWatchPanelProps = {
  crateId: string;
  status: string;
  watch: CrateWatch;
  entitlements: CrateEntitlements;
  /** The new watch state after a change, so the page keeps its copy current. */
  onWatchChange: (watch: CrateWatch) => void;
};

/**
 * Watch a saved crate for new releases that fit its filters (#1967). Only the
 * watch is sent to the server, so unsaved edits to the title or lines are never
 * saved by accident. Turning watching off is one action and is always allowed.
 */
export function CrateWatchPanel({
  crateId,
  status,
  watch,
  entitlements,
  onWatchChange,
}: CrateWatchPanelProps) {
  const { token } = useAuth();
  const { addToast } = useToast();
  const [days, setDays] = useState<number>(DEFAULT_WATCH_DAYS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const change = useCallback(
    async (mode: "off" | "notify") => {
      if (!token) return;
      setBusy(true);
      setError(null);
      try {
        const result = await setCrateWatch(
          token,
          crateId,
          mode === "notify" ? { mode, expiresInDays: days } : { mode },
        );
        onWatchChange(result.crate.watch);
        addToast({
          type: "success",
          title: mode === "notify" ? "Watching this crate" : "Stopped watching",
        });
      } catch (err) {
        if (mountedRef.current) {
          setError(crateErrorMessage(err, "The watch could not be changed. Please try again."));
        }
      } finally {
        if (mountedRef.current) setBusy(false);
      }
    },
    [addToast, crateId, days, onWatchChange, token],
  );

  return (
    <CrateWatchView
      availability={watchAvailability({ status, watchEntitlement: entitlements?.watch })}
      watch={watch}
      days={days}
      busy={busy}
      error={error}
      onDaysChange={setDays}
      onTurnOn={() => void change("notify")}
      onStop={() => void change("off")}
    />
  );
}
