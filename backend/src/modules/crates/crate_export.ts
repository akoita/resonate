import { sanitizeStemAudioFeatures } from "../ingestion/stem-audio-features";
import { measuredTrackFeatures } from "../agents/measured_track_features";
import { CRATE_STEM_TYPES, type CrateLicenseType } from "./crate.types";

/**
 * Crate export to rekordbox XML and a Serato crate (#1965,
 * docs/features/crate_digger.md).
 *
 * Pure: no database, no clock, no randomness, no I/O. The service decides WHICH
 * stems the DJ may export (stems they own under a standard license); this file
 * only turns that list into file names, a rekordbox collection and a Serato
 * crate, so the output is byte-for-byte testable against checked-in fixtures.
 *
 * File names are decided here, once: the web saves each downloaded stem under
 * the manifest's `fileName`, and both exports point at the same name inside the
 * folder the DJ typed. The folder is only used to build the path written into
 * the file. It is never stored and never logged.
 *
 * Business model: ADR-BM-6 Line 3, phase 2 (export makes buying useful for a
 * working DJ). Export grants no rights and changes no fee.
 */

export const CRATE_EXPORT_FORMATS = ["rekordbox", "serato"] as const;
export type CrateExportFormat = (typeof CRATE_EXPORT_FORMATS)[number];

export function isCrateExportFormat(value: unknown): value is CrateExportFormat {
  return typeof value === "string" && (CRATE_EXPORT_FORMATS as readonly string[]).includes(value);
}

/** Title used when a crate has none, in file names, playlists and albums. */
export const CRATE_EXPORT_DEFAULT_TITLE = "Resonate crate";

/** Credited artist used when a track names none. */
export const CRATE_EXPORT_UNKNOWN_ARTIST = "Unknown Artist";

/** Longest folder text accepted. */
export const CRATE_EXPORT_FOLDER_MAX_LENGTH = 400;

/** Longest stem file name before the extension. */
export const CRATE_EXPORT_FILE_NAME_MAX_LENGTH = 150;

/**
 * License tiers whose standard terms include the full-quality stem download
 * (docs/rfc/business-model.md). `sync`, `sample` and `broadcast` have no
 * standard terms, so they carry no export right.
 */
export const CRATE_EXPORT_LICENSE_TYPES = ["personal", "remix", "commercial"] as const;
export type CrateExportLicenseType = (typeof CRATE_EXPORT_LICENSE_TYPES)[number];

/** The highest standard tier among `licenseTypes`, or null when none is standard. */
export function bestExportLicense(
  licenseTypes: Iterable<CrateLicenseType | string>,
): CrateExportLicenseType | null {
  const owned = new Set<string>(licenseTypes);
  for (const tier of [...CRATE_EXPORT_LICENSE_TYPES].reverse()) {
    if (owned.has(tier)) return tier;
  }
  return null;
}

/** Why a crate line is not in the export. */
export type CrateExportSkipReason = "not_purchased" | "no_export_right";

/** One exported stem: everything the two file builders and the manifest need. */
export type CrateExportEntry = {
  /** 0-based position of the crate line the stem belongs to. */
  position: number;
  trackId: string;
  stemId: string;
  stemType: string;
  /** The track title, without the stem label. */
  title: string;
  artistName: string;
  licenseType: CrateExportLicenseType;
  fileName: string;
  /** Measured tempo, or null. */
  bpm: number | null;
  /** Key name such as "Am", "C" or "F#m", or null. */
  key: string | null;
  camelot: string | null;
  /** Measured first beat in seconds, or null. */
  firstBeatSec: number | null;
};

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const STEM_LABELS: Readonly<Record<string, string>> = {
  vocals: "Vocals",
  drums: "Drums",
  bass: "Bass",
  piano: "Piano",
  guitar: "Guitar",
  other: "Other",
};

/** The human label of a stem type: "drums" -> "Drums". */
export function stemLabel(stemType: string): string {
  const type = stemType.trim().toLowerCase();
  if (STEM_LABELS[type]) return STEM_LABELS[type];
  if (!type) return "Stem";
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** Position of a stem type in the crate's stem order; unknown types sort last. */
export function stemTypeRank(stemType: string): number {
  const index = (CRATE_STEM_TYPES as readonly string[]).indexOf(stemType.toLowerCase());
  return index === -1 ? CRATE_STEM_TYPES.length : index;
}

// eslint-disable-next-line no-control-regex
const FILE_NAME_FORBIDDEN = /[<>:"/\\|?*\u0000-\u001f\u007f]/g;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * A text made safe as one file name part on Windows and macOS: the characters
 * `<>:"/\|?*` and control characters are removed, runs of spaces collapse,
 * leading and trailing dots and spaces are trimmed, and the result is cut to
 * `maxLength` characters (code points). Empty results become "Untitled".
 */
export function sanitizeFileNamePart(
  text: string,
  maxLength: number = CRATE_EXPORT_FILE_NAME_MAX_LENGTH,
): string {
  const cleaned = collapse(text.replace(FILE_NAME_FORBIDDEN, " "));
  let cut = trimDotsAndSpaces(Array.from(cleaned).slice(0, maxLength).join(""));
  if (!cut) return "Untitled";
  if (WINDOWS_RESERVED.test(cut)) cut = `_${cut}`;
  return cut;
}

function collapse(text: string): string {
  return text.replace(/\s+/g, " ");
}

function trimDotsAndSpaces(text: string): string {
  return text.replace(/^[. ]+/, "").replace(/[. ]+$/, "");
}

/**
 * `${artist} - ${title} (${StemLabel}).mp3` for one stem. Artist and title are
 * sanitized and the pair is shortened so the whole base stays within
 * {@link CRATE_EXPORT_FILE_NAME_MAX_LENGTH} characters and the stem label is
 * never cut off. A title that already starts with `${artist} - ` (uploads
 * often name the file that way) is not prefixed a second time.
 */
export function stemFileName(input: {
  artistName: string;
  title: string;
  stemType: string;
}): string {
  const suffix = ` (${stemLabel(input.stemType)})`;
  const room = CRATE_EXPORT_FILE_NAME_MAX_LENGTH - Array.from(suffix).length;
  const artist = sanitizeFileNamePart(input.artistName);
  let title = sanitizeFileNamePart(input.title);
  const prefix = `${artist} - `;
  if (title.length > prefix.length && title.toLowerCase().startsWith(prefix.toLowerCase())) {
    title = sanitizeFileNamePart(title.slice(prefix.length));
  }
  const head = sanitizeFileNamePart(`${artist} - ${title}`, room);
  return `${head}${suffix}.mp3`;
}

/**
 * File names for `stems`, in order. The first stem keeps the plain name; a
 * later stem whose name collides (compared case-insensitively, as macOS and
 * Windows do) gets ` [${first 6 of stemId}]` before the extension, with more
 * characters of the id only if even that collides.
 */
export function assignStemFileNames(
  stems: ReadonlyArray<{ stemId: string; artistName: string; title: string; stemType: string }>,
): string[] {
  const used = new Set<string>();
  return stems.map((stem) => {
    const plain = stemFileName(stem);
    let name = plain;
    for (let length = 6; used.has(name.toLowerCase()); length += 1) {
      const base = plain.slice(0, -".mp3".length);
      name = `${base} [${stem.stemId.slice(0, length)}].mp3`;
      if (length > stem.stemId.length) break;
    }
    used.add(name.toLowerCase());
    return name;
  });
}

/** `<crate title>.<extension>`, sanitized. */
export function crateFileName(title: string | null, extension: "xml" | "crate"): string {
  const name = title && title.trim() ? title : CRATE_EXPORT_DEFAULT_TITLE;
  return `${sanitizeFileNamePart(name)}.${extension}`;
}

// ---------------------------------------------------------------------------
// Measured features
// ---------------------------------------------------------------------------

/** What an exported stem carries about its tempo, key and first beat. */
export type CrateExportFeatures = {
  bpm: number | null;
  key: string | null;
  camelot: string | null;
  firstBeatSec: number | null;
};

/**
 * The measured tempo, key and first beat of a stem, from the track's measured
 * features (the current `original` stem) and, where the mix has none, from the
 * stem's own `audioFeatures`. Stems are separated from the mix and share its
 * timeline, so every stem of a track gets the mix's grid; a lone bass or
 * guitar stem often measures at double time or with a late first beat. The
 * first beat follows the tempo: it comes from the same payload as the tempo it
 * is paired with. Tempo and key use the platform's measured confidence gates
 * (`measuredTrackFeatures`); nothing is guessed.
 */
export function exportFeatures(stemFeatures: unknown, trackFeatures: unknown): CrateExportFeatures {
  const own = measuredTrackFeatures(stemFeatures);
  const track = measuredTrackFeatures(trackFeatures);

  const tempoFromTrack = track.tempoBpm !== null;
  const tempoSource = tempoFromTrack ? track : own;
  const bpm = tempoSource.tempoBpm === null ? null : Number(tempoSource.tempoBpm.toFixed(2));
  const beatSource = tempoFromTrack ? trackFeatures : stemFeatures;
  const firstBeat = bpm === null ? null : sanitizeStemAudioFeatures(beatSource)?.firstBeatSec ?? null;

  const keySource = track.key !== null ? track : own;
  return {
    bpm,
    key: keyName(keySource.key, keySource.camelot),
    camelot: keySource.camelot,
    firstBeatSec: firstBeat === null ? null : Number(firstBeat.toFixed(3)),
  };
}

// ---------------------------------------------------------------------------
// Folder paths
// ---------------------------------------------------------------------------

/** An absolute folder the DJ typed, split into what the formats need. */
export type ExportFolder =
  | { kind: "posix"; segments: string[] }
  | { kind: "windows"; drive: string; segments: string[] };

// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;

/**
 * Parses an absolute folder path: POSIX (`/Users/dj/Music`) or Windows
 * (`C:\Users\dj\Music`, forward slashes accepted). Returns null for anything
 * else: not a string, empty, over 400 characters, control characters, a
 * relative path, or a `.` / `..` segment. Never echoes the input.
 */
export function parseExportFolder(folder: unknown): ExportFolder | null {
  if (typeof folder !== "string") return null;
  if (folder.length === 0 || folder.length > CRATE_EXPORT_FOLDER_MAX_LENGTH) return null;
  if (CONTROL_CHARACTERS.test(folder)) return null;

  const windows = /^([A-Za-z]):[\\/]/.exec(folder);
  if (windows) {
    const segments = folder
      .slice(3)
      .split(/[\\/]+/)
      .filter((segment) => segment !== "");
    if (segments.some(isDotSegment)) return null;
    return { kind: "windows", drive: `${windows[1].toUpperCase()}:`, segments };
  }
  if (folder.startsWith("/")) {
    const segments = folder.split("/").filter((segment) => segment !== "");
    if (segments.some(isDotSegment)) return null;
    return { kind: "posix", segments };
  }
  return null;
}

function isDotSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

/** Percent-encodes one path segment (RFC 3986 unreserved characters stay). */
function encodePathSegment(segment: string): string {
  return encodeURIComponent(segment).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * rekordbox's `Location` of a file: `file://localhost` plus the percent-encoded
 * absolute path. `C:\a b\x.mp3` becomes `file://localhost/C:/a%20b/x.mp3`.
 */
export function rekordboxLocation(folder: ExportFolder, fileName: string): string {
  const parts = [...folder.segments, fileName].map(encodePathSegment);
  const head = folder.kind === "windows" ? [folder.drive] : [];
  return `file://localhost/${[...head, ...parts].join("/")}`;
}

/**
 * The path Serato stores: relative to the root of the volume the file is on.
 * POSIX drops the leading "/" and, for `/Volumes/<name>/...`, the volume too;
 * Windows drops the drive and uses "/" separators.
 */
export function seratoRelativePath(folder: ExportFolder, fileName: string): string {
  let segments = folder.segments;
  if (folder.kind === "posix" && segments[0] === "Volumes" && segments.length >= 2) {
    segments = segments.slice(2);
  }
  return [...segments, fileName].join("/");
}

// ---------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------

/** Camelot code -> key name. Sharp spellings, as the platform's key tables use. */
export const CAMELOT_KEY_NAMES: Readonly<Record<string, string>> = Object.freeze({
  "1A": "G#m",
  "2A": "D#m",
  "3A": "A#m",
  "4A": "Fm",
  "5A": "Cm",
  "6A": "Gm",
  "7A": "Dm",
  "8A": "Am",
  "9A": "Em",
  "10A": "Bm",
  "11A": "F#m",
  "12A": "C#m",
  "1B": "B",
  "2B": "F#",
  "3B": "C#",
  "4B": "G#",
  "5B": "D#",
  "6B": "A#",
  "7B": "F",
  "8B": "C",
  "9B": "G",
  "10B": "D",
  "11B": "A",
  "12B": "E",
});

/**
 * The key name for a measured key: "Am", "C", "F#m". The tonic and mode win;
 * without a usable tonic the Camelot code is translated through a fixed table;
 * with neither the key is unknown (null), never guessed.
 */
export function keyName(
  key: { tonic: string; mode: "major" | "minor" } | null,
  camelot: string | null,
): string | null {
  if (key) {
    const tonic = key.tonic.trim().replace("♯", "#").replace("♭", "b");
    const match = /^([A-Ga-g])([#b]?)$/.exec(tonic);
    if (match && (key.mode === "major" || key.mode === "minor")) {
      return `${match[1].toUpperCase()}${match[2]}${key.mode === "minor" ? "m" : ""}`;
    }
  }
  if (camelot) {
    const code = camelot.trim().toUpperCase();
    return CAMELOT_KEY_NAMES[code] ?? null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// rekordbox XML
// ---------------------------------------------------------------------------

// XML 1.0 forbids most control characters and the non-characters U+FFFE/U+FFFF;
// lone surrogates are not valid text either.
const XML_INVALID =
  // eslint-disable-next-line no-control-regex
  /[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]|[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g;

/** An attribute value: invalid characters stripped, whitespace flattened, XML escaped. */
export function xmlEscape(text: string): string {
  return text
    .replace(XML_INVALID, "")
    .replace(/[\t\n\r]/g, " ")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function attributes(pairs: ReadonlyArray<readonly [string, string]>): string {
  return pairs.map(([name, value]) => `${name}="${xmlEscape(value)}"`).join(" ");
}

/** The rekordbox track name: the title and the stem label. */
export function rekordboxTrackName(entry: Pick<CrateExportEntry, "title" | "stemType">): string {
  return `${entry.title} (${stemLabel(entry.stemType)})`;
}

/**
 * A rekordbox collection XML (`DJ_PLAYLISTS` 1.0.0) of the entries, one playlist
 * holding them in order. The tempo grid and the "First beat" memory cue are
 * written only for an entry with both a measured tempo and a measured first
 * beat: neither is ever guessed.
 */
export function buildRekordboxXml(input: {
  crateTitle: string | null;
  folder: ExportFolder;
  entries: readonly CrateExportEntry[];
}): string {
  const title = input.crateTitle && input.crateTitle.trim() ? input.crateTitle : CRATE_EXPORT_DEFAULT_TITLE;
  const count = input.entries.length;
  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<DJ_PLAYLISTS Version="1.0.0">',
    `  <PRODUCT ${attributes([
      ["Name", "Resonate"],
      ["Version", "1.0.0"],
      ["Company", "Resonate"],
    ])}/>`,
    `  <COLLECTION Entries="${count}">`,
  ];

  input.entries.forEach((entry, index) => {
    const pairs: Array<readonly [string, string]> = [
      ["TrackID", String(index + 1)],
      ["Name", rekordboxTrackName(entry)],
      ["Artist", entry.artistName],
      ["Album", title],
      ["Kind", "MP3 File"],
    ];
    if (entry.bpm !== null) pairs.push(["AverageBpm", entry.bpm.toFixed(2)]);
    if (entry.key !== null) pairs.push(["Tonality", entry.key]);
    pairs.push(["Location", rekordboxLocation(input.folder, entry.fileName)]);

    if (entry.bpm !== null && entry.firstBeatSec !== null) {
      const start = entry.firstBeatSec.toFixed(3);
      lines.push(
        `    <TRACK ${attributes(pairs)}>`,
        `      <TEMPO ${attributes([
          ["Inizio", start],
          ["Bpm", entry.bpm.toFixed(2)],
          ["Metro", "4/4"],
          ["Battito", "1"],
        ])}/>`,
        `      <POSITION_MARK ${attributes([
          ["Name", "First beat"],
          ["Type", "0"],
          ["Start", start],
          ["Num", "-1"],
        ])}/>`,
        "    </TRACK>",
      );
    } else {
      lines.push(`    <TRACK ${attributes(pairs)}/>`);
    }
  });

  lines.push(
    "  </COLLECTION>",
    "  <PLAYLISTS>",
    '    <NODE Type="0" Name="ROOT" Count="1">',
    `      <NODE ${attributes([
      ["Type", "1"],
      ["Name", title],
      ["KeyType", "0"],
      ["Entries", String(count)],
    ])}>`,
  );
  for (let index = 0; index < count; index += 1) {
    lines.push(`        <TRACK Key="${index + 1}"/>`);
  }
  lines.push("      </NODE>", "    </NODE>", "  </PLAYLISTS>", "</DJ_PLAYLISTS>");
  return `${lines.join("\n")}\n`;
}

// ---------------------------------------------------------------------------
// Serato crate
// ---------------------------------------------------------------------------

/** The version string of a Serato crate file. */
export const SERATO_CRATE_VERSION = "1.0/Serato ScratchLive Crate";

function utf16be(text: string): Buffer {
  return Buffer.from(text, "utf16le").swap16();
}

/** One Serato tag: a 4-byte ASCII id, a 4-byte big-endian length, the payload. */
function seratoTag(id: string, payload: Buffer): Buffer {
  const header = Buffer.alloc(8);
  header.write(id, 0, 4, "ascii");
  header.writeUInt32BE(payload.length, 4);
  return Buffer.concat([header, payload]);
}

/**
 * A Serato `.crate` file: the `vrsn` tag, then one `otrk` tag per entry holding
 * a `ptrk` tag with the file's path relative to its volume, all in UTF-16BE.
 * Serato reads tempo, key and cues from its own analysis or the file's tags, so
 * the crate carries none of them.
 */
export function buildSeratoCrate(input: {
  folder: ExportFolder;
  entries: ReadonlyArray<Pick<CrateExportEntry, "fileName">>;
}): Buffer {
  const tags: Buffer[] = [seratoTag("vrsn", utf16be(SERATO_CRATE_VERSION))];
  for (const entry of input.entries) {
    const path = seratoRelativePath(input.folder, entry.fileName);
    tags.push(seratoTag("otrk", seratoTag("ptrk", utf16be(path))));
  }
  return Buffer.concat(tags);
}

// ---------------------------------------------------------------------------
// Response headers
// ---------------------------------------------------------------------------

/**
 * `Content-Disposition: attachment` with an ASCII `filename` fallback and the
 * RFC 5987 `filename*` carrying the real UTF-8 name.
 */
export function contentDisposition(fileName: string): string {
  const fallback = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\%]/g, "_");
  const encoded = encodeURIComponent(fileName).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encoded}`;
}
