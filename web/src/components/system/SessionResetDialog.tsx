"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";

/**
 * Guided session-reset dialog (#1199). Shown when the app detects it is now
 * talking to a new or reset backend environment, so a returning user's saved
 * sign-in no longer applies. The copy is deliberately reassuring about
 * passkeys: we never delete them, and they still control any on-chain account.
 */
export function SessionResetDialog({
  isOpen,
  onReset,
  onDismiss,
}: {
  isOpen: boolean;
  onReset: () => void | Promise<void>;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  const [working, setWorking] = useState(false);

  useEffect(() => setMounted(true), []);

  if (!mounted || !isOpen) return null;

  const handleReset = async () => {
    setWorking(true);
    try {
      await onReset();
    } finally {
      // The reset reloads the page; if it somehow returns, re-enable.
      setWorking(false);
    }
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="session-reset-title"
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/70 p-4"
    >
      <div className="w-full max-w-md rounded-xl border border-zinc-700 bg-zinc-900 p-6 shadow-2xl">
        <h2
          id="session-reset-title"
          className="text-lg font-semibold text-white"
        >
          This environment was updated
        </h2>
        <div className="mt-3 space-y-3 text-sm text-zinc-300">
          <p>
            You&apos;re now connected to an updated version of Resonate. The
            sign-in saved in this browser is from a previous version and no
            longer applies here, so some actions may fail until you reset.
          </p>
          <p>
            We&apos;ll clear this browser&apos;s saved session for you and
            reload — then you can sign in fresh. Nothing on-chain is affected.
          </p>
          <p className="rounded-md border border-emerald-500/30 bg-emerald-500/10 p-3 text-emerald-200">
            <span className="font-medium">Your passkey is safe.</span> We never
            delete it — it stays in your device and still controls any account
            it created. You&apos;ll simply use it to sign in again.
          </p>
          <p className="text-xs text-zinc-500">
            If anything still looks off after the reload, do a hard refresh
            (Ctrl/Cmd&nbsp;+&nbsp;Shift&nbsp;+&nbsp;R).
          </p>
        </div>
        <div className="mt-5 flex items-center justify-end gap-3">
          <button
            type="button"
            className="ui-btn ui-btn-ghost"
            onClick={onDismiss}
            disabled={working}
          >
            Not now
          </button>
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={() => void handleReset()}
            disabled={working}
          >
            {working ? "Resetting…" : "Reset and continue"}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
