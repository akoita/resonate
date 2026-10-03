/**
 * Crate export (#1965) — pure unit tests. The rekordbox XML and the Serato
 * crate are compared byte for byte with the fixtures under
 * `fixtures/crate-export/`, and the Serato bytes are also decoded by an
 * independent tag reader so the fixture is not the only check.
 */

import * as fs from "fs";
import * as path from "path";
import {
  assignStemFileNames,
  bestExportLicense,
  buildRekordboxXml,
  buildSeratoCrate,
  CAMELOT_KEY_NAMES,
  contentDisposition,
  crateFileName,
  exportFeatures,
  keyName,
  parseExportFolder,
  rekordboxLocation,
  sanitizeFileNamePart,
  seratoRelativePath,
  stemFileName,
  stemLabel,
  xmlEscape,
  type CrateExportEntry,
} from "../modules/crates/crate_export";

const FIXTURES = path.join(__dirname, "fixtures", "crate-export");
const readFixture = (name: string) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const readHexFixture = (name: string) => Buffer.from(readFixture(name).replace(/\s+/g, ""), "hex");

const data = JSON.parse(readFixture("entries.json")) as {
  crateTitle: string;
  entries: Array<Omit<CrateExportEntry, "fileName">>;
};
const fileNames = assignStemFileNames(data.entries);
const entries: CrateExportEntry[] = data.entries.map((entry, index) => ({
  ...entry,
  fileName: fileNames[index],
}));

const folder = (text: string) => {
  const parsed = parseExportFolder(text);
  if (!parsed) throw new Error("test folder should parse");
  return parsed;
};

/** Reads `id | length | payload` tags, independent of the builder. */
function readTags(bytes: Buffer): Array<{ id: string; payload: Buffer }> {
  const tags: Array<{ id: string; payload: Buffer }> = [];
  let offset = 0;
  while (offset < bytes.length) {
    const id = bytes.subarray(offset, offset + 4).toString("ascii");
    const length = bytes.readUInt32BE(offset + 4);
    tags.push({ id, payload: bytes.subarray(offset + 8, offset + 8 + length) });
    offset += 8 + length;
  }
  expect(offset).toBe(bytes.length);
  return tags;
}

const decodeUtf16be = (bytes: Buffer) => Buffer.from(bytes).swap16().toString("utf16le");

describe("fixture file names", () => {
  it("names stems `artist - title (Stem).mp3` and suffixes a collision with the stem id", () => {
    expect(fileNames).toEqual([
      "Ada & Bob - Say Hi 3 & more (Vocals).mp3",
      "DJ Öz - Night Drive (Bass).mp3",
      "DJ Öz - Night Drive (Bass) [cccccc].mp3",
    ]);
  });
});

describe("rekordbox XML fixtures", () => {
  it("matches the POSIX fixture byte for byte", () => {
    const xml = buildRekordboxXml({
      crateTitle: data.crateTitle,
      folder: folder("/Users/dj/Music/Resonate Crate"),
      entries,
    });
    expect(xml).toBe(readFixture("rekordbox-posix.xml"));
  });

  it("matches the Windows fixture byte for byte", () => {
    const xml = buildRekordboxXml({
      crateTitle: data.crateTitle,
      folder: folder("C:\\Users\\dj\\My Music\\Crates"),
      entries,
    });
    expect(xml).toBe(readFixture("rekordbox-windows.xml"));
    expect(xml).toContain('Location="file://localhost/C:/Users/dj/My%20Music/Crates/');
  });

  it("writes a tempo and a First beat cue only for the entry with a tempo and a first beat", () => {
    const xml = readFixture("rekordbox-posix.xml");
    expect(xml.match(/<TEMPO /g)).toHaveLength(1);
    expect(xml.match(/<POSITION_MARK /g)).toHaveLength(1);
    expect(xml).toContain('<TEMPO Inizio="0.123" Bpm="128.00" Metro="4/4" Battito="1"/>');
    expect(xml).toContain('<POSITION_MARK Name="First beat" Type="0" Start="0.123" Num="-1"/>');
    // The entry with a tempo but no first beat has the tempo, no grid, no cue.
    expect(xml).toContain('AverageBpm="122.50" Tonality="F#m"');
  });

  it("omits AverageBpm and Tonality when they are unknown", () => {
    const third = readFixture("rekordbox-posix.xml").split("\n").find((line) => line.includes('TrackID="3"'));
    expect(third).toBeDefined();
    expect(third).not.toContain("AverageBpm");
    expect(third).not.toContain("Tonality");
  });

  it("escapes & < > \" ' and strips XML-invalid control characters", () => {
    expect(xmlEscape(`a&b<c>d"e'f`)).toBe("a&amp;b&lt;c&gt;d&quot;e&apos;f");
    expect(xmlEscape("x\u0000y\u0008z\u000bw\ufffe")).toBe("xyzw");
    expect(xmlEscape("line\nbreak\ttab")).toBe("line break tab");
    expect(xmlEscape("lone\ud800 surrogate")).toBe("lone surrogate");
    expect(xmlEscape("pair \u{1f3a7}")).toBe("pair \u{1f3a7}");
  });

  it("writes an empty collection and playlist for no entries", () => {
    const xml = buildRekordboxXml({ crateTitle: null, folder: folder("/Music"), entries: [] });
    expect(xml).toContain('<COLLECTION Entries="0">');
    expect(xml).toContain('Name="Resonate crate" KeyType="0" Entries="0"');
  });
});

describe("Serato crate fixtures", () => {
  it("matches the /Volumes fixture byte for byte", () => {
    const bytes = buildSeratoCrate({ folder: folder("/Volumes/DJ Drive/Music/Resonate"), entries });
    expect(bytes.equals(readHexFixture("serato-volumes.crate.hex"))).toBe(true);
  });

  it("matches the Windows fixture byte for byte", () => {
    const bytes = buildSeratoCrate({ folder: folder("C:\\Users\\dj\\My Music\\Crates"), entries });
    expect(bytes.equals(readHexFixture("serato-windows.crate.hex"))).toBe(true);
  });

  it("decodes as a vrsn tag followed by one otrk/ptrk per entry, paths relative to the volume", () => {
    const tags = readTags(readHexFixture("serato-volumes.crate.hex"));
    expect(tags.map((tag) => tag.id)).toEqual(["vrsn", "otrk", "otrk", "otrk"]);
    expect(decodeUtf16be(tags[0].payload)).toBe("1.0/Serato ScratchLive Crate");

    const paths = tags.slice(1).map((tag) => {
      const inner = readTags(tag.payload);
      expect(inner.map((t) => t.id)).toEqual(["ptrk"]);
      return decodeUtf16be(inner[0].payload);
    });
    expect(paths).toEqual(entries.map((entry) => `Music/Resonate/${entry.fileName}`));
  });

  it("writes only the version tag for no entries", () => {
    const tags = readTags(buildSeratoCrate({ folder: folder("/Music"), entries: [] }));
    expect(tags.map((tag) => tag.id)).toEqual(["vrsn"]);
  });
});

describe("folder parsing and paths", () => {
  it("accepts POSIX and Windows absolute folders", () => {
    expect(parseExportFolder("/Users/dj/Music/")).toEqual({ kind: "posix", segments: ["Users", "dj", "Music"] });
    expect(parseExportFolder("/")).toEqual({ kind: "posix", segments: [] });
    expect(parseExportFolder("C:\\a b\\c")).toEqual({ kind: "windows", drive: "C:", segments: ["a b", "c"] });
    expect(parseExportFolder("d:/Music//Crates\\")).toEqual({ kind: "windows", drive: "D:", segments: ["Music", "Crates"] });
    expect(parseExportFolder("C:\\")).toEqual({ kind: "windows", drive: "C:", segments: [] });
  });

  it.each([
    undefined,
    null,
    42,
    ["/a", "/b"],
    "",
    "Music/Crates",
    "~/Music",
    "C:Music",
    "\\\\server\\share",
    "/Users/dj/../root",
    "/a/./b",
    "/Users/dj\u0000/Music",
    "/Users/dj\n/Music",
  ])("rejects %p", (value) => {
    expect(parseExportFolder(value)).toBeNull();
  });

  it("accepts a folder of exactly 400 characters and rejects 401", () => {
    expect(parseExportFolder(`/${"a".repeat(399)}`)).not.toBeNull();
    expect(parseExportFolder(`/${"a".repeat(400)}`)).toBeNull();
  });

  it("builds the rekordbox location with percent-encoding", () => {
    expect(rekordboxLocation(folder("C:\\a b\\"), "x.mp3")).toBe("file://localhost/C:/a%20b/x.mp3");
    expect(rekordboxLocation(folder("/Users/dj/Music"), "A & B (1)!.mp3")).toBe(
      "file://localhost/Users/dj/Music/A%20%26%20B%20%281%29%21.mp3",
    );
    expect(rekordboxLocation(folder("/"), "x.mp3")).toBe("file://localhost/x.mp3");
  });

  it("builds the Serato path relative to the volume root", () => {
    expect(seratoRelativePath(folder("/Users/dj/Music"), "x.mp3")).toBe("Users/dj/Music/x.mp3");
    expect(seratoRelativePath(folder("/Volumes/DJ/Music"), "x.mp3")).toBe("Music/x.mp3");
    expect(seratoRelativePath(folder("/Volumes/DJ"), "x.mp3")).toBe("x.mp3");
    expect(seratoRelativePath(folder("/Volumes"), "x.mp3")).toBe("Volumes/x.mp3");
    expect(seratoRelativePath(folder("C:\\Users\\dj\\Music"), "x.mp3")).toBe("Users/dj/Music/x.mp3");
    expect(seratoRelativePath(folder("D:\\"), "x.mp3")).toBe("x.mp3");
  });
});

describe("file names", () => {
  it("strips Windows and macOS forbidden characters, collapses spaces, trims dots", () => {
    expect(sanitizeFileNamePart('  a<b>c:d"e/f\\g|h?i*j\u0001k  ')).toBe("a b c d e f g h i j k");
    expect(sanitizeFileNamePart("...Title...")).toBe("Title");
    expect(sanitizeFileNamePart("a    b\t c")).toBe("a b c");
    expect(sanitizeFileNamePart("???")).toBe("Untitled");
    expect(sanitizeFileNamePart("CON")).toBe("_CON");
  });

  it("keeps the stem label when the title is long, within 150 characters before the extension", () => {
    const name = stemFileName({ artistName: "A".repeat(100), title: "T".repeat(200), stemType: "drums" });
    expect(name.endsWith(" (Drums).mp3")).toBe(true);
    expect(name.length - ".mp3".length).toBeLessThanOrEqual(150);
  });

  it("does not repeat an artist the title already starts with", () => {
    expect(
      stemFileName({ artistName: "The Game", title: "The Game - How We Do (ft 50 Cent)", stemType: "bass" }),
    ).toBe("The Game - How We Do (ft 50 Cent) (Bass).mp3");
    expect(stemFileName({ artistName: "the game", title: "THE GAME - Dreams", stemType: "vocals" })).toBe(
      "the game - Dreams (Vocals).mp3",
    );
    // A title that is only the prefix, or merely starts with the artist's name, keeps it.
    expect(stemFileName({ artistName: "Ada", title: "Ada - ", stemType: "drums" })).toBe("Ada - Ada - (Drums).mp3");
    expect(stemFileName({ artistName: "Ada", title: "Adagio", stemType: "piano" })).toBe("Ada - Adagio (Piano).mp3");
  });

  it("labels stem types", () => {
    expect(stemLabel("vocals")).toBe("Vocals");
    expect(stemLabel("OTHER")).toBe("Other");
    expect(stemLabel("strings")).toBe("Strings");
  });

  it("suffixes collisions case-insensitively and leaves the first name plain", () => {
    const names = assignStemFileNames([
      { stemId: "abcdef-1", artistName: "A", title: "T", stemType: "bass" },
      { stemId: "123456-2", artistName: "a", title: "t", stemType: "bass" },
      { stemId: "123456-3", artistName: "A", title: "T", stemType: "bass" },
    ]);
    expect(names[0]).toBe("A - T (Bass).mp3");
    expect(names[1]).toBe("a - t (Bass) [123456].mp3");
    expect(names[2]).toBe("A - T (Bass) [123456-].mp3");
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(3);
  });

  it("names the crate file and falls back to a default title", () => {
    expect(crateFileName('My: "crate"', "xml")).toBe("My crate.xml");
    expect(crateFileName(null, "crate")).toBe("Resonate crate.crate");
    expect(crateFileName("   ", "xml")).toBe("Resonate crate.xml");
  });

  it("builds Content-Disposition with an ASCII fallback and the RFC 5987 name", () => {
    expect(contentDisposition("DJ Öz - set.xml")).toBe(
      "attachment; filename=\"DJ _z - set.xml\"; filename*=UTF-8''DJ%20%C3%96z%20-%20set.xml",
    );
    expect(contentDisposition("a(1)'.xml")).toContain("filename*=UTF-8''a%281%29%27.xml");
  });
});

describe("keys", () => {
  it("names a key from tonic and mode", () => {
    expect(keyName({ tonic: "A", mode: "minor" }, null)).toBe("Am");
    expect(keyName({ tonic: "C", mode: "major" }, "8B")).toBe("C");
    expect(keyName({ tonic: "F#", mode: "minor" }, null)).toBe("F#m");
    expect(keyName({ tonic: "bb", mode: "major" }, null)).toBe("Bb");
    expect(keyName({ tonic: "E♭", mode: "minor" }, null)).toBe("Ebm");
  });

  it("falls back to the Camelot table, then to nothing", () => {
    expect(keyName({ tonic: "H", mode: "minor" }, "8A")).toBe("Am");
    expect(keyName(null, "11b")).toBe("A");
    expect(keyName(null, "13A")).toBeNull();
    expect(keyName(null, null)).toBeNull();
  });

  it("covers all 24 Camelot codes with distinct key names", () => {
    expect(Object.keys(CAMELOT_KEY_NAMES)).toHaveLength(24);
    expect(new Set(Object.values(CAMELOT_KEY_NAMES)).size).toBe(24);
  });
});

describe("licenses", () => {
  it("picks the highest standard tier and ignores tiers without standard terms", () => {
    expect(bestExportLicense(["personal", "commercial", "remix"])).toBe("commercial");
    expect(bestExportLicense(["personal", "remix"])).toBe("remix");
    expect(bestExportLicense(["sync", "personal"])).toBe("personal");
    expect(bestExportLicense(["sync", "sample", "broadcast"])).toBeNull();
    expect(bestExportLicense([])).toBeNull();
  });
});

describe("measured features", () => {
  const features = (overrides: Record<string, unknown>) => ({
    schemaVersion: "stem-audio-features/v1",
    extractor: { name: "test", version: "1" },
    tempoBpm: 128.004,
    tempoConfidence: 0.8,
    firstBeatSec: 0.12349,
    key: { tonic: "A", mode: "minor", confidence: 0.4 },
    analysisRevision: 3,
    ...overrides,
  });

  it("uses the stem's own measured tempo, key and first beat when the mix has none", () => {
    expect(exportFeatures(features({}), null)).toEqual({
      bpm: 128,
      key: "Am",
      camelot: "8A",
      firstBeatSec: 0.123,
    });
  });

  it("prefers the mix's measured features, so every stem of a track shares one grid", () => {
    // A lone bass stem measured at double time with a late first beat, as on a
    // real export: the mix's tempo, key and first beat win.
    const bass = features({ tempoBpm: 184.57, firstBeatSec: 9.648, key: { tonic: "G", mode: "major", confidence: 0.4 } });
    const mix = features({ tempoBpm: 92.29, firstBeatSec: 0.5, key: { tonic: "E", mode: "minor", confidence: 0.4 } });
    expect(exportFeatures(bass, mix)).toEqual({
      bpm: 92.29,
      key: "Em",
      camelot: "9A",
      firstBeatSec: 0.5,
    });
  });

  it("takes the tempo and first beat together from one source", () => {
    // The mix has a key but no confident tempo: tempo and first beat come from
    // the stem, the key from the mix.
    const stem = features({ tempoBpm: 100, firstBeatSec: 0.2 });
    const mix = features({ tempoConfidence: 0.1, firstBeatSec: 7, key: { tonic: "C", mode: "major", confidence: 0.4 } });
    expect(exportFeatures(stem, mix)).toEqual({
      bpm: 100,
      key: "C",
      camelot: "8B",
      firstBeatSec: 0.2,
    });
  });

  it("never guesses: a low-confidence tempo or key and a missing first beat stay null", () => {
    const weak = features({ tempoConfidence: 0.2, key: { tonic: "A", mode: "minor", confidence: 0.01 } });
    expect(exportFeatures(weak, null)).toEqual({ bpm: null, key: null, camelot: null, firstBeatSec: null });
    expect(exportFeatures(features({ firstBeatSec: null }), null).firstBeatSec).toBeNull();
    expect(exportFeatures(null, undefined)).toEqual({ bpm: null, key: null, camelot: null, firstBeatSec: null });
    expect(exportFeatures({ garbage: true }, "nope")).toEqual({ bpm: null, key: null, camelot: null, firstBeatSec: null });
  });
});
