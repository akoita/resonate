"use client";

import { useState } from "react";
import { requestPersonalDataExport, saveBlobAsDownload } from "../../lib/api";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

/**
 * #1771: where a person takes a copy of their own data away with them.
 *
 * Two things this panel refuses to do. It does not promise more than we can
 * give: the file is what Resonate holds in its own systems, and the copy says
 * so in the same breath as the offer, next to the button, rather than in a
 * footnote nobody reads. And it does not pretend the button is instant — a
 * long history takes a while to assemble, so the control says it is working
 * and stays disabled until the file is in the browser's hands.
 */
export default function DataExportPanel({ token, addToast }: Props) {
  const [downloading, setDownloading] = useState(false);

  const download = async () => {
    // The guard, not just the disabled attribute: a second request while the
    // first is still streaming would spend one of the three the server allows
    // per hour on a file this person is already getting.
    if (!token || downloading) return;
    setDownloading(true);
    try {
      await downloadPersonalDataExport(token, addToast);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <DataExportCard
      downloading={downloading}
      signedIn={Boolean(token)}
      onDownload={() => void download()}
    />
  );
}

/**
 * Fetch the export and hand it to the browser, saying plainly which of the
 * three outcomes happened. Kept out of the component so the rate-limited case
 * can be asserted as its own message rather than as a generic failure.
 */
export async function downloadPersonalDataExport(token: string, addToast: ToastFn): Promise<void> {
  try {
    const result = await requestPersonalDataExport(token);

    if (result.status === "rate_limited") {
      // Nothing went wrong and nothing is missing: they already have a recent
      // copy. Saying "error" here would read as data loss.
      addToast({
        type: "info",
        title: "You asked for this recently",
        message: "You can download your data a few times an hour. Please try again a little later.",
      });
      return;
    }

    if (!saveBlobAsDownload(result.blob, result.filename)) {
      throw new Error("This browser could not start the download.");
    }

    addToast({
      type: "success",
      title: "Your data is downloading",
      message: `Look for ${result.filename} wherever this browser saves downloads.`,
    });
  } catch {
    addToast({
      type: "error",
      title: "Download did not start",
      message: "Something went wrong on our side while preparing your file. Please try again in a moment.",
    });
  }
}

/**
 * The panel itself, kept presentational so the honest-limits copy and the
 * in-progress state can be asserted without an auth session.
 */
export function DataExportCard({
  downloading,
  signedIn,
  onDownload,
}: {
  downloading: boolean;
  signedIn: boolean;
  onDownload: () => void;
}) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <span className="settings-kicker">Your data</span>
          <h2 className="settings-section-title">Download your data</h2>
          <p className="settings-copy">
            Your data is yours. Ask for it here and we will put it into a single file for you: your
            account and profile, what you have uploaded, bought, sold, and earned, your library and
            playlists, what you have sent us, and — if you allowed it — the record of how you use
            Resonate.
          </p>
        </div>
      </div>

      <div className="settings-source">
        <div className="settings-source-actions">
          <button
            type="button"
            className="ui-btn ui-btn-primary"
            onClick={onDownload}
            disabled={!signedIn || downloading}
          >
            {downloading ? "Preparing your file..." : "Download my data"}
          </button>
        </div>
        <p className="settings-copy">
          {downloading
            ? "This can take a minute if you have a lot of history. Your file will download on its own when it is ready."
            : "The file is yours to keep, read, or take anywhere else. It arrives as a .json file, which any text editor can open."}
        </p>
        <p className="settings-copy">
          The file holds what Resonate keeps about you in our own systems. It does not include files
          stored on IPFS or entries written to the blockchain: those live outside Resonate, are
          public by design, and stay where they are. Where we keep our own copy or record of one of
          them, that copy is in your file.
        </p>
      </div>
    </div>
  );
}
