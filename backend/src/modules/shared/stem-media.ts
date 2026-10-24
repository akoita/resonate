/**
 * Audio formats a stem can be stored and delivered in (#1976).
 *
 * Separated stems are MP3 320 kbps; official stems are lossless WAV or FLAC and
 * are delivered as uploaded. Every place that names a downloaded stem or sets
 * its Content-Type reads `Stem.mimeType` through this module instead of
 * assuming MP3. Pure; no I/O.
 */

export const MP3_MIME_TYPE = "audio/mpeg";

/** Lossless containers an artist may upload as an official stem. */
export const OFFICIAL_STEM_FORMATS = [
  { extension: "wav", mimeType: "audio/wav", kind: "WAV File" },
  { extension: "flac", mimeType: "audio/flac", kind: "FLAC File" },
] as const;

const EXTENSION_BY_MIME: Readonly<Record<string, string>> = {
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/wav": "wav",
  "audio/x-wav": "wav",
  "audio/wave": "wav",
  "audio/vnd.wave": "wav",
  "audio/flac": "flac",
  "audio/x-flac": "flac",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/ogg": "ogg",
  "audio/aiff": "aiff",
  "audio/x-aiff": "aiff",
};

const CANONICAL_MIME_BY_EXTENSION: Readonly<Record<string, string>> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  flac: "audio/flac",
  m4a: "audio/mp4",
  aac: "audio/aac",
  ogg: "audio/ogg",
  aiff: "audio/aiff",
  aif: "audio/aiff",
};

const REKORDBOX_KIND: Readonly<Record<string, string>> = {
  mp3: "MP3 File",
  wav: "WAV File",
  flac: "FLAC File",
  m4a: "M4A File",
  aac: "AAC File",
  ogg: "OGG File",
  aiff: "AIFF File",
};

function baseMime(mimeType: string | null | undefined): string {
  return String(mimeType ?? "").split(";")[0].trim().toLowerCase();
}

/** The Content-Type to send for a stem: its stored MIME type, else MP3. */
export function stemContentType(mimeType: string | null | undefined): string {
  const mime = baseMime(mimeType);
  return mime.startsWith("audio/") ? mime : MP3_MIME_TYPE;
}

/** The file extension (no dot) of a stored MIME type; MP3 when unknown. */
export function stemFileExtension(mimeType: string | null | undefined): string {
  return EXTENSION_BY_MIME[baseMime(mimeType)] ?? "mp3";
}

/** The file extension (no dot) of a stored MIME type, or null when it is not a known audio type. */
export function knownStemFileExtension(mimeType: string | null | undefined): string | null {
  return EXTENSION_BY_MIME[baseMime(mimeType)] ?? null;
}

/** The canonical MIME type of a file extension, or null when not audio we serve. */
export function mimeTypeForExtension(extension: string | null | undefined): string | null {
  const key = String(extension ?? "").replace(/^\./, "").trim().toLowerCase();
  return CANONICAL_MIME_BY_EXTENSION[key] ?? null;
}

/** rekordbox `Kind` attribute for a stem file ("WAV File", "FLAC File", "MP3 File"). */
export function rekordboxKind(mimeType: string | null | undefined): string {
  return REKORDBOX_KIND[stemFileExtension(mimeType)] ?? "MP3 File";
}

/** Whether a stored MIME type is one of the lossless official-stem formats. */
export function isLosslessStemMime(mimeType: string | null | undefined): boolean {
  const extension = EXTENSION_BY_MIME[baseMime(mimeType)];
  return extension === "wav" || extension === "flac";
}

/**
 * A safe attachment file name: the stem's title or type, stripped of path and
 * header-breaking characters, with the extension of its stored MIME type.
 */
export function stemDownloadFileName(
  stem: { title?: string | null; type?: string | null; mimeType?: string | null },
): string {
  const raw = String(stem.title || stem.type || "stem");
  const cleaned = raw
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/:*?<>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
  return `${cleaned || "stem"}.${stemFileExtension(stem.mimeType)}`;
}
