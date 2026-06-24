"use client";

import { useState } from "react";
import { useUpdateAvailable } from "../../hooks/useUpdateAvailable";

/**
 * Non-intrusive, persistent prompt inviting the user to refresh once a newer
 * build has been deployed. Sits bottom-center (clear of the bottom-right
 * toasts), stays until the user refreshes or dismisses, and re-appears if an
 * even newer version ships after a dismiss.
 */
export default function UpdateAvailablePrompt() {
  const { updateAvailable, deployedVersion, reload } = useUpdateAvailable();
  // Hidden only while the *current* deployed version is the one the user
  // dismissed; a newer version differs again and re-surfaces the prompt without
  // any effect/derived-state syncing.
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const visible = updateAvailable && deployedVersion !== dismissedVersion;
  if (!visible) return null;

  return (
    <div className="update-prompt" role="status" aria-live="polite">
      <span className="update-prompt__dot" aria-hidden />
      <div className="update-prompt__text">
        <strong className="update-prompt__title">A new version is available</strong>
        <span className="update-prompt__hint">Refresh to get the latest improvements.</span>
      </div>
      <button type="button" className="update-prompt__refresh" onClick={reload}>
        Refresh
      </button>
      <button
        type="button"
        className="update-prompt__dismiss"
        aria-label="Dismiss update notification"
        onClick={() => setDismissedVersion(deployedVersion)}
      >
        <span aria-hidden>✕</span>
      </button>
    </div>
  );
}
