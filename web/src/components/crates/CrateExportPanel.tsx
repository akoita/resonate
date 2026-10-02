"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import { useToast } from "../ui/Toast";
import { downloadCrateExport, downloadOwnedStem, getCrateExportManifest } from "../../lib/api";
import {
  crateExportErrorMessage,
  downloadStemsSequentially,
  EXPORT_FORMAT_LABELS,
  exportEntryLabel,
  fallbackExportFileName,
  fileNameFromDisposition,
  folderPlaceholder,
  readStoredFolder,
  saveBlob,
  storeFolder,
} from "../../lib/crateExport";
import type { CrateExportFormat, CrateExportManifest } from "../../lib/crates";
import { CrateExportView, type CrateExportBusy } from "./CrateExportView";

export type CrateExportPanelProps = {
  crateId: string;
  crateTitle: string | null;
  /** The export reads the saved crate; unsaved edits are flagged, not exported. */
  hasUnsavedChanges: boolean;
  /** Changes after a purchase, so the list of stems you own is read again. */
  refreshKey: number;
};

/**
 * Export a crate to rekordbox or Serato (#1965).
 *
 * Shows the stems the wallet owns for this crate's tracks (the only ones that
 * can be exported) and the lines left out with a reason. "Download stems" saves
 * each stem under the name the export files use; the folder field says where
 * those files now are on the DJ's disk, so the generated rekordbox XML or Serato
 * crate points at them. Nothing here buys or licenses anything.
 */
export function CrateExportPanel({
  crateId,
  crateTitle,
  hasUnsavedChanges,
  refreshKey,
}: CrateExportPanelProps) {
  const { token, address, smartAccountAddress } = useAuth();
  const { addToast } = useToast();
  const wallet = smartAccountAddress || address;

  const [manifest, setManifest] = useState<CrateExportManifest | null>(null);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [folder, setFolder] = useState("");
  const [placeholder, setPlaceholder] = useState("/Users/you/Music/Resonate");
  const [busy, setBusy] = useState<CrateExportBusy>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [failedStems, setFailedStems] = useState<Array<{ label: string; message: string }>>([]);
  const mountedRef = useRef(true);
  const runningRef = useRef(false);

  // The remembered folder and an OS-aware example are read after mount, so the
  // server-rendered markup and the first client render agree.
  useEffect(() => {
    setFolder(readStoredFolder());
    if (typeof navigator !== "undefined") setPlaceholder(folderPlaceholder(navigator.userAgent));
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    setLoadState("loading");
    getCrateExportManifest(token, crateId)
      .then((result) => {
        if (cancelled) return;
        setManifest(result);
        setLoadError(null);
        setLoadState("ready");
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadError(crateExportErrorMessage(err, "The list of stems you can export could not be loaded."));
        setLoadState("error");
      });
    return () => {
      cancelled = true;
    };
  }, [crateId, refreshKey, token]);

  const onFolderChange = (value: string) => {
    setFolder(value);
    storeFolder(value);
  };

  const downloadStems = useCallback(async () => {
    if (!token || !wallet || !manifest || runningRef.current) return;
    runningRef.current = true;
    setNotice(null);
    setFailedStems([]);
    setBusy({ kind: "stems", done: 0, total: manifest.entries.length });
    try {
      const result = await downloadStemsSequentially({
        entries: manifest.entries,
        download: (entry) => downloadOwnedStem(token, entry.stemId, wallet),
        save: saveBlob,
        onProgress: (done, total) => {
          if (mountedRef.current) setBusy({ kind: "stems", done, total });
        },
        isCancelled: () => !mountedRef.current,
      });
      if (!mountedRef.current) return;
      setFailedStems(result.failed.map((item) => ({ label: exportEntryLabel(item.entry), message: item.message })));
      if (result.failed.length === 0) {
        setNotice(
          `Saved ${result.saved.length} ${result.saved.length === 1 ? "stem" : "stems"}. Move them into one folder, then type that folder below.`,
        );
        addToast({ type: "success", title: "Stems downloaded" });
      } else {
        addToast({
          type: "error",
          title: "Some stems could not be downloaded",
          message: `${result.saved.length} saved, ${result.failed.length} failed.`,
        });
      }
    } finally {
      runningRef.current = false;
      if (mountedRef.current) setBusy(null);
    }
  }, [addToast, manifest, token, wallet]);

  const exportFile = useCallback(
    async (format: CrateExportFormat) => {
      if (!token || runningRef.current) return;
      runningRef.current = true;
      setNotice(null);
      setBusy({ kind: "file", format });
      try {
        const file = await downloadCrateExport(token, crateId, format, folder.trim());
        saveBlob(file.blob, fileNameFromDisposition(file.contentDisposition, fallbackExportFileName(format, crateTitle)));
        if (mountedRef.current) {
          addToast({ type: "success", title: `${EXPORT_FORMAT_LABELS[format]} saved` });
        }
      } catch (err) {
        if (mountedRef.current) {
          addToast({
            type: "error",
            title: `Could not export the ${EXPORT_FORMAT_LABELS[format]}`,
            message: crateExportErrorMessage(err, "Please try again."),
          });
        }
      } finally {
        runningRef.current = false;
        if (mountedRef.current) setBusy(null);
      }
    },
    [addToast, crateId, crateTitle, folder, token],
  );

  return (
    <CrateExportView
      loadState={loadState}
      loadError={loadError}
      manifest={manifest}
      folder={folder}
      placeholder={placeholder}
      busy={busy}
      notice={notice}
      failedStems={failedStems}
      canDownload={Boolean(wallet)}
      hasUnsavedChanges={hasUnsavedChanges}
      onFolderChange={onFolderChange}
      onDownloadStems={() => void downloadStems()}
      onExport={(format) => void exportFile(format)}
    />
  );
}
