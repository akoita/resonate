/**
 * Crate export helpers (#1965): folder validation and memory, labels, file
 * names from the server's headers, the sequential stem download and errors.
 */
import { describe, expect, it, vi } from "vitest";
import {
  crateExportErrorMessage,
  downloadStemsSequentially,
  EXPORT_FOLDER_MAX_LENGTH,
  EXPORT_FOLDER_STORAGE_KEY,
  exportEntryDetails,
  exportEntryLabel,
  fallbackExportFileName,
  fileNameFromDisposition,
  folderPlaceholder,
  isAbsoluteFolder,
  readStoredFolder,
  skipReasonText,
  storeFolder,
} from "./crateExport";
import type { CrateExportEntry } from "./crates";

function entry(overrides: Partial<CrateExportEntry> = {}): CrateExportEntry {
  return {
    position: 0,
    trackId: "t1",
    stemId: "s1",
    stemType: "vocals",
    title: "Neon Drift",
    artistName: "Aya Volt",
    licenseType: "personal",
    fileName: "Aya Volt - Neon Drift (Vocals).mp3",
    bpm: 128,
    key: "Am",
    camelot: "8A",
    firstBeatSec: 0.123,
    hasCue: true,
    ...overrides,
  };
}

function memoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    removeItem: (key: string) => void data.delete(key),
    data,
  };
}

describe("isAbsoluteFolder", () => {
  it.each(["/Users/you/Music", "/", "C:\\Users\\you\\Music", "d:/Music", "  /Users/you  "])(
    "accepts %j",
    (folder) => expect(isAbsoluteFolder(folder)).toBe(true),
  );

  it.each(["", "   ", "Music/Crates", "~/Music", "C:Music", "\\\\server\\share", "/a\u0000b", "/a\nb"])(
    "rejects %j",
    (folder) => expect(isAbsoluteFolder(folder)).toBe(false),
  );

  it("accepts exactly 400 characters and rejects more", () => {
    expect(isAbsoluteFolder(`/${"a".repeat(EXPORT_FOLDER_MAX_LENGTH - 1)}`)).toBe(true);
    expect(isAbsoluteFolder(`/${"a".repeat(EXPORT_FOLDER_MAX_LENGTH)}`)).toBe(false);
  });
});

describe("folderPlaceholder", () => {
  it("matches the operating system", () => {
    expect(folderPlaceholder("Mozilla/5.0 (Windows NT 10.0; Win64; x64)")).toBe("C:\\Users\\you\\Music\\Resonate");
    expect(folderPlaceholder("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)")).toBe("/Users/you/Music/Resonate");
    expect(folderPlaceholder("Mozilla/5.0 (X11; Linux x86_64)")).toBe("/home/you/Music/Resonate");
    expect(folderPlaceholder("")).toBe("/Users/you/Music/Resonate");
  });
});

describe("the remembered folder", () => {
  it("round-trips through the browser store and forgets an empty folder", () => {
    const store = memoryStore();
    expect(readStoredFolder(store)).toBe("");
    storeFolder("/Users/you/Music/Resonate", store);
    expect(store.data.get(EXPORT_FOLDER_STORAGE_KEY)).toBe("/Users/you/Music/Resonate");
    expect(readStoredFolder(store)).toBe("/Users/you/Music/Resonate");
    storeFolder("   ", store);
    expect(readStoredFolder(store)).toBe("");
  });

  it("never throws when storage is unavailable or blocked", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
      removeItem: () => {
        throw new Error("blocked");
      },
    };
    expect(readStoredFolder(blocked)).toBe("");
    expect(() => storeFolder("/Music", blocked)).not.toThrow();
    expect(readStoredFolder(null)).toBe("");
    expect(() => storeFolder("/Music", null)).not.toThrow();
  });

  it("ignores a stored value that is too long", () => {
    expect(readStoredFolder(memoryStore({ [EXPORT_FOLDER_STORAGE_KEY]: "x".repeat(401) }))).toBe("");
  });
});

describe("what is shown", () => {
  it("labels a stem and says what was measured", () => {
    expect(exportEntryLabel(entry())).toBe("Neon Drift: Vocals");
    expect(exportEntryDetails(entry())).toBe("128 BPM · Am (8A) · cue at 0.123 s");
    expect(exportEntryDetails(entry({ bpm: 122.5, firstBeatSec: null, hasCue: false }))).toBe(
      "122.5 BPM · Am (8A) · no cue",
    );
  });

  it("says plainly when tempo or key were not measured", () => {
    expect(exportEntryDetails(entry({ bpm: null, key: null, camelot: null, firstBeatSec: null, hasCue: false }))).toBe(
      "Tempo not measured · Key not measured · no cue",
    );
    expect(exportEntryDetails(entry({ camelot: null }))).toContain("Am ·");
  });

  it("explains each skip reason", () => {
    expect(skipReasonText("not_purchased")).toBe("You do not own a stem of this track yet.");
    expect(skipReasonText("no_export_right")).toMatch(/no standard terms/);
  });
});

describe("file names from the server", () => {
  it("prefers the RFC 5987 name, then the plain one, then the fallback", () => {
    expect(
      fileNameFromDisposition(`attachment; filename="DJ _z.xml"; filename*=UTF-8''DJ%20%C3%96z.xml`, "x.xml"),
    ).toBe("DJ Öz.xml");
    expect(fileNameFromDisposition('attachment; filename="Crate.crate"', "x.crate")).toBe("Crate.crate");
    expect(fileNameFromDisposition("attachment", "x.xml")).toBe("x.xml");
    expect(fileNameFromDisposition(null, "x.xml")).toBe("x.xml");
    expect(fileNameFromDisposition("attachment; filename*=UTF-8''%E0%A4%A", "x.xml")).toBe("x.xml");
  });

  it("builds a fallback name from the crate title", () => {
    expect(fallbackExportFileName("rekordbox", 'Friday: "warm-up"')).toBe("Friday warm-up.xml");
    expect(fallbackExportFileName("serato", null)).toBe("Resonate crate.crate");
  });
});

describe("downloadStemsSequentially", () => {
  const entries = [
    entry({ stemId: "s1", fileName: "one.mp3" }),
    entry({ stemId: "s2", fileName: "two.mp3" }),
    entry({ stemId: "s3", fileName: "three.mp3" }),
  ];

  it("downloads one at a time and saves each under its manifest name", async () => {
    let running = 0;
    let maxRunning = 0;
    const saved: string[] = [];
    const progress: Array<[number, number]> = [];
    const result = await downloadStemsSequentially({
      entries,
      download: async (item) => {
        running += 1;
        maxRunning = Math.max(maxRunning, running);
        await Promise.resolve();
        running -= 1;
        return new Blob([item.stemId]);
      },
      save: (_blob, fileName) => void saved.push(fileName),
      onProgress: (done, total) => void progress.push([done, total]),
    });
    expect(maxRunning).toBe(1);
    expect(saved).toEqual(["one.mp3", "two.mp3", "three.mp3"]);
    expect(progress).toEqual([
      [0, 3],
      [1, 3],
      [2, 3],
    ]);
    expect(result).toMatchObject({ failed: [], cancelled: false });
    expect(result.saved).toHaveLength(3);
  });

  it("reports a failed stem and goes on with the rest", async () => {
    const save = vi.fn();
    const result = await downloadStemsSequentially({
      entries,
      download: async (item) => {
        if (item.stemId === "s2") throw new Error("You do not own this stem.");
        return new Blob(["x"]);
      },
      save,
    });
    expect(save).toHaveBeenCalledTimes(2);
    expect(result.saved.map((item) => item.stemId)).toEqual(["s1", "s3"]);
    expect(result.failed).toEqual([{ entry: entries[1], message: "You do not own this stem." }]);
  });

  it("stops when cancelled", async () => {
    let calls = 0;
    const result = await downloadStemsSequentially({
      entries,
      download: async () => {
        calls += 1;
        return new Blob(["x"]);
      },
      save: () => undefined,
      isCancelled: () => calls >= 1,
    });
    expect(calls).toBe(1);
    expect(result.cancelled).toBe(true);
    expect(result.saved).toHaveLength(1);
  });
});

describe("crateExportErrorMessage", () => {
  const failure = (code: string, message = "server words") => ({ status: 400, details: { code, message } });

  it("turns the backend's codes into plain messages", () => {
    expect(crateExportErrorMessage(failure("invalid_folder"), "x")).toMatch(/full path of the folder/);
    expect(crateExportErrorMessage(failure("nothing_to_export"), "x")).toMatch(/None of the stems/);
    expect(crateExportErrorMessage(failure("no_wallet"), "x")).toMatch(/Create your wallet/);
    expect(crateExportErrorMessage(failure("pro_required"), "x")).toBe("This needs Crate Digger Pro.");
  });

  it("falls back to the server's message, then to the fallback", () => {
    expect(crateExportErrorMessage({ details: { message: "Crate not found" } }, "x")).toBe("Crate not found");
    expect(crateExportErrorMessage(new Error("boom"), "Please try again.")).toBe("Please try again.");
  });
});
