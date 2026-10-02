/**
 * Crate export helpers (#1965): the folder the DJ typed, what is shown for each
 * stem and skipped line, the sequential stem download, and plain-language errors.
 *
 * The backend decides the file names (`fileName` in the manifest) and builds the
 * rekordbox and Serato files from the stems the DJ owns. The browser downloads
 * each stem through the licensed download path, saves it under that name, and
 * tells the backend which folder holds them so the files can point at it.
 *
 * PRIVACY: the folder can contain the DJ's username. It is remembered in this
 * browser only (localStorage), sent to the export route, and never logged: none
 * of these helpers write to the console.
 */

import {
  crateErrorCode,
  crateErrorMessage,
  type CrateExportEntry,
  type CrateExportFormat,
  type CrateExportSkipReason,
} from "./crates";

/** Longest folder the backend accepts. */
export const EXPORT_FOLDER_MAX_LENGTH = 400;

export const EXPORT_FOLDER_STORAGE_KEY = "resonate.crateExportFolder";

/** Plain wording for the two formats. */
export const EXPORT_FORMAT_LABELS: Record<CrateExportFormat, string> = {
  rekordbox: "rekordbox XML",
  serato: "Serato crate",
};

/* ------------------------------------------------------------------ */
/* The folder                                                          */
/* ------------------------------------------------------------------ */

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/** True for an absolute POSIX (`/Users/you/Music`) or Windows (`C:\Users\you`) folder. */
export function isAbsoluteFolder(folder: string): boolean {
  const value = folder.trim();
  if (value.length === 0 || value.length > EXPORT_FOLDER_MAX_LENGTH) return false;
  if (CONTROL_CHARACTERS.test(value)) return false;
  return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value);
}

/** An example path for the DJ's operating system, from the browser's user agent. */
export function folderPlaceholder(userAgent: string): string {
  if (/windows/i.test(userAgent)) return "C:\\Users\\you\\Music\\Resonate";
  if (/mac os x|macintosh/i.test(userAgent) && !/iphone|ipad/i.test(userAgent)) {
    return "/Users/you/Music/Resonate";
  }
  if (/linux/i.test(userAgent) && !/android/i.test(userAgent)) return "/home/you/Music/Resonate";
  return "/Users/you/Music/Resonate";
}

type FolderStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function browserStore(): FolderStore | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** The folder remembered for this browser, or "". Never throws. */
export function readStoredFolder(store: FolderStore | null = browserStore()): string {
  if (!store) return "";
  try {
    const value = store.getItem(EXPORT_FOLDER_STORAGE_KEY);
    return typeof value === "string" && value.length <= EXPORT_FOLDER_MAX_LENGTH ? value : "";
  } catch {
    return "";
  }
}

/** Remembers the folder for this browser; an empty folder forgets it. Never throws. */
export function storeFolder(folder: string, store: FolderStore | null = browserStore()): void {
  if (!store) return;
  try {
    if (folder.trim() === "") store.removeItem(EXPORT_FOLDER_STORAGE_KEY);
    else store.setItem(EXPORT_FOLDER_STORAGE_KEY, folder.slice(0, EXPORT_FOLDER_MAX_LENGTH));
  } catch {
    // Private mode or a full disk: the folder is simply not remembered.
  }
}

/* ------------------------------------------------------------------ */
/* What is shown                                                       */
/* ------------------------------------------------------------------ */

const titleCase = (text: string) => (text ? text.charAt(0).toUpperCase() + text.slice(1) : text);

/** "Neon Drift: Vocals". */
export function exportEntryLabel(entry: Pick<CrateExportEntry, "title" | "stemType">): string {
  return `${entry.title || "Untitled track"}: ${titleCase(entry.stemType)}`;
}

/** "128 BPM · Am (8A) · cue at 0.123 s"; says what was not measured instead of guessing. */
export function exportEntryDetails(entry: CrateExportEntry): string {
  const parts: string[] = [];
  parts.push(entry.bpm === null ? "Tempo not measured" : `${Number(entry.bpm.toFixed(2))} BPM`);
  if (entry.key) parts.push(entry.camelot ? `${entry.key} (${entry.camelot})` : entry.key);
  else parts.push("Key not measured");
  if (entry.hasCue && entry.firstBeatSec !== null) {
    parts.push(`cue at ${entry.firstBeatSec.toFixed(3)} s`);
  } else {
    parts.push("no cue");
  }
  return parts.join(" · ");
}

export function exportLicenseText(license: CrateExportEntry["licenseType"]): string {
  return `${titleCase(license)} license`;
}

export function skipReasonText(reason: CrateExportSkipReason): string {
  return reason === "no_export_right"
    ? "Your license for this track has no standard terms, so it is not exported."
    : "You do not own a stem of this track yet.";
}

/* ------------------------------------------------------------------ */
/* Files                                                               */
/* ------------------------------------------------------------------ */

/**
 * The file name in a `Content-Disposition` header: the RFC 5987 `filename*`
 * when present, else `filename`, else `fallback`.
 */
export function fileNameFromDisposition(header: string | null | undefined, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*UTF-8''([^;]+)/i.exec(header);
  if (star) {
    try {
      const decoded = decodeURIComponent(star[1].trim());
      if (decoded) return decoded;
    } catch {
      // Fall through to the plain filename.
    }
  }
  const plain = /filename\s*=\s*"([^"]*)"/i.exec(header) ?? /filename\s*=\s*([^;]+)/i.exec(header);
  const value = plain?.[1]?.trim();
  return value ? value : fallback;
}

/** The name used when the browser cannot read the server's `Content-Disposition`. */
export function fallbackExportFileName(format: CrateExportFormat, crateTitle: string | null): string {
  const base = (crateTitle ?? "").replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim();
  return `${base || "Resonate crate"}.${format === "rekordbox" ? "xml" : "crate"}`;
}

/** Saves a blob through a temporary download link. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  // Give the browser a moment to start the save before the URL goes away.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export type StemDownloadResult = {
  saved: CrateExportEntry[];
  failed: Array<{ entry: CrateExportEntry; message: string }>;
  /** True when the run stopped early because it was cancelled. */
  cancelled: boolean;
};

/**
 * Downloads the stems one after another, each through `download` (the licensed
 * download path) and saved under the manifest's `fileName`. A stem that fails
 * is reported and the rest still go on; nothing is retried.
 */
export async function downloadStemsSequentially(input: {
  entries: readonly CrateExportEntry[];
  download: (entry: CrateExportEntry) => Promise<Blob>;
  save: (blob: Blob, fileName: string) => void;
  onProgress?: (done: number, total: number, current: CrateExportEntry) => void;
  isCancelled?: () => boolean;
}): Promise<StemDownloadResult> {
  const result: StemDownloadResult = { saved: [], failed: [], cancelled: false };
  const total = input.entries.length;
  for (const [index, entry] of input.entries.entries()) {
    if (input.isCancelled?.()) {
      result.cancelled = true;
      break;
    }
    input.onProgress?.(index, total, entry);
    try {
      input.save(await input.download(entry), entry.fileName);
      result.saved.push(entry);
    } catch (error) {
      result.failed.push({
        entry,
        message: error instanceof Error && error.message ? error.message : "Download failed",
      });
    }
  }
  return result;
}

/* ------------------------------------------------------------------ */
/* Errors                                                              */
/* ------------------------------------------------------------------ */

/** A person-readable message for a failed export call. */
export function crateExportErrorMessage(error: unknown, fallback: string): string {
  switch (crateErrorCode(error)) {
    case "invalid_folder":
      return "Type the full path of the folder, like /Users/you/Music/Resonate or C:\\Users\\you\\Music\\Resonate.";
    case "nothing_to_export":
      return "None of the stems in this crate are ones you own with a license that includes export.";
    case "no_wallet":
      return "Create your wallet first. Export lists the stems your wallet owns.";
    default:
      return crateErrorMessage(error, fallback);
  }
}
