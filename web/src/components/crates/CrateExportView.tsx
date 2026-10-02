"use client";

import {
  EXPORT_FOLDER_MAX_LENGTH,
  EXPORT_FORMAT_LABELS,
  exportEntryDetails,
  exportEntryLabel,
  exportLicenseText,
  isAbsoluteFolder,
  skipReasonText,
} from "../../lib/crateExport";
import type { CrateExportFormat, CrateExportManifest } from "../../lib/crates";
import "../../styles/crates.css";

export type CrateExportBusy =
  | { kind: "stems"; done: number; total: number }
  | { kind: "file"; format: CrateExportFormat }
  | null;

export type CrateExportViewProps = {
  loadState: "loading" | "ready" | "error";
  loadError: string | null;
  manifest: CrateExportManifest | null;
  folder: string;
  placeholder: string;
  busy: CrateExportBusy;
  notice: string | null;
  failedStems: Array<{ label: string; message: string }>;
  /** False while there is no wallet address to download with. */
  canDownload: boolean;
  /** The export reads the saved crate, so unsaved edits are not in it yet. */
  hasUnsavedChanges?: boolean;
  onFolderChange: (folder: string) => void;
  onDownloadStems: () => void;
  onExport: (format: CrateExportFormat) => void;
};

/** The markup of the export panel (#1965); the state lives in `CrateExportPanel`. */
export function CrateExportView({
  loadState,
  loadError,
  manifest,
  folder,
  placeholder,
  busy,
  notice,
  failedStems,
  canDownload,
  hasUnsavedChanges = false,
  onFolderChange,
  onDownloadStems,
  onExport,
}: CrateExportViewProps) {
  const entries = manifest?.entries ?? [];
  const skipped = manifest?.skipped ?? [];
  const folderValid = isAbsoluteFolder(folder);
  const folderTyped = folder.trim() !== "";
  const canExport = entries.length > 0 && folderValid && busy === null;

  return (
    <section className="crates-panel crates-export-panel" aria-labelledby="crate-export-heading">
      <h2 id="crate-export-heading">Export to rekordbox or Serato</h2>
      <p className="crates-hint">
        Take the stems you own from this crate into your DJ software. Export only lists stems you
        already own under a personal, remix or commercial license. It never buys or licenses
        anything.
      </p>

      {hasUnsavedChanges ? (
        <p className="crates-notice" data-testid="crate-export-unsaved">
          This list comes from your saved crate. Save your changes to see them here.
        </p>
      ) : null}

      <p className="crates-hint" role="status" aria-live="polite" data-testid="crate-export-progress">
        {busy?.kind === "stems"
          ? `Downloading stem ${Math.min(busy.done + 1, busy.total)} of ${busy.total}…`
          : busy?.kind === "file"
            ? `Building your ${EXPORT_FORMAT_LABELS[busy.format]}…`
            : ""}
      </p>

      {loadState === "loading" ? (
        <p className="crates-hint" aria-busy="true">
          Checking which stems you own…
        </p>
      ) : null}
      {loadState === "error" ? (
        <p className="crates-error" role="alert">
          {loadError}
        </p>
      ) : null}

      {loadState === "ready" && manifest ? (
        <>
          {entries.length === 0 ? (
            <p className="crates-notice" data-testid="crate-export-empty">
              Nothing to export yet. Buy stems from this crate and they will show up here.
            </p>
          ) : (
            <>
              <h3 className="crates-export-title">
                Stems you can export ({entries.length})
              </h3>
              <ul className="crates-export-list" aria-label="Stems you can export">
                {entries.map((entry) => (
                  <li key={entry.stemId} className="crates-export-entry" data-stem-id={entry.stemId}>
                    <strong>{exportEntryLabel(entry)}</strong>
                    <span className="crates-hint">
                      {entry.artistName} · {exportLicenseText(entry.licenseType)}
                    </span>
                    <span className="crates-hint">{exportEntryDetails(entry)}</span>
                    <span className="crates-hint">
                      Saved as <code>{entry.fileName}</code>
                    </span>
                  </li>
                ))}
              </ul>

              <div className="crates-export-step">
                <h3 className="crates-export-title">1. Download the stems</h3>
                <p className="crates-hint">
                  Your browser saves one file per stem. If it asks, allow multiple downloads, then
                  move the files into one folder on this computer.
                </p>
                <div className="crates-row">
                  <button
                    type="button"
                    className="crates-btn crates-btn--primary"
                    onClick={() => onDownloadStems()}
                    disabled={busy !== null || !canDownload}
                  >
                    Download stems
                  </button>
                  {!canDownload ? <span className="crates-hint">Connect your wallet to download.</span> : null}
                </div>
                {notice ? <p className="crates-notice">{notice}</p> : null}
                {failedStems.length > 0 ? (
                  <div role="alert" className="crates-error">
                    <p>These stems could not be downloaded:</p>
                    <ul className="crates-export-failures">
                      {failedStems.map((item) => (
                        <li key={item.label}>
                          {item.label}: {item.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="crates-export-step">
                <h3 className="crates-export-title">2. Tell us where you saved them</h3>
                <div className="crates-field">
                  <label htmlFor="crate-export-folder">Folder where you saved these files</label>
                  <input
                    id="crate-export-folder"
                    className="crates-title-input"
                    type="text"
                    value={folder}
                    maxLength={EXPORT_FOLDER_MAX_LENGTH}
                    placeholder={placeholder}
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby="crate-export-folder-hint"
                    aria-invalid={folderTyped && !folderValid}
                    onChange={(event) => onFolderChange(event.target.value)}
                  />
                  <p id="crate-export-folder-hint" className="crates-hint">
                    The full path, for example {placeholder}. The export files point at it. It stays
                    in this browser; Resonate does not keep it.
                  </p>
                  {folderTyped && !folderValid ? (
                    <p className="crates-error" role="status">
                      Type the full path, starting with / or a drive letter like C:\
                    </p>
                  ) : null}
                </div>
              </div>

              <div className="crates-export-step">
                <h3 className="crates-export-title">3. Export your crate</h3>
                <div className="crates-row">
                  <button
                    type="button"
                    className="crates-btn crates-btn--primary"
                    onClick={() => onExport("rekordbox")}
                    disabled={!canExport}
                  >
                    {EXPORT_FORMAT_LABELS.rekordbox}
                  </button>
                  <button
                    type="button"
                    className="crates-btn crates-btn--primary"
                    onClick={() => onExport("serato")}
                    disabled={!canExport}
                  >
                    {EXPORT_FORMAT_LABELS.serato}
                  </button>
                </div>
                <ul className="crates-export-help">
                  <li>
                    <strong>rekordbox:</strong> open File &gt; Import &gt; rekordbox xml, or point
                    Preferences &gt; Advanced &gt; rekordbox xml at the file. It carries each
                    stem&apos;s measured tempo and key, and a cue at the first beat where we
                    measured one.
                  </li>
                  <li>
                    <strong>Serato:</strong> copy the crate file into the <code>_Serato_/Subcrates</code>{" "}
                    folder on the same drive as your stems. It lists the files only; Serato works
                    out tempo, key and cues from its own analysis.
                  </li>
                </ul>
                {manifest.notes.length > 0 ? (
                  <ul className="crates-export-notes" aria-label="Good to know">
                    {manifest.notes.map((note) => (
                      <li key={note} className="crates-hint">
                        {note}
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            </>
          )}

          {skipped.length > 0 ? (
            <div className="crates-export-step">
              <h3 className="crates-export-title">Left out ({skipped.length})</h3>
              <ul className="crates-export-skipped" aria-label="Lines left out of the export">
                {skipped.map((item) => (
                  <li key={item.trackId} data-track-id={item.trackId}>
                    <strong>{item.title || "Untitled track"}</strong>: {skipReasonText(item.reason)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
