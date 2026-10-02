import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CrateExportView, type CrateExportViewProps } from "./CrateExportView";
import type { CrateExportEntry, CrateExportManifest } from "../../lib/crates";

function entry(overrides: Partial<CrateExportEntry> = {}): CrateExportEntry {
  return {
    position: 0,
    trackId: "t1",
    stemId: "s1",
    stemType: "vocals",
    title: "Neon Drift",
    artistName: "Aya Volt",
    licenseType: "commercial",
    fileName: "Aya Volt - Neon Drift (Vocals).mp3",
    bpm: 128,
    key: "Am",
    camelot: "8A",
    firstBeatSec: 0.123,
    hasCue: true,
    ...overrides,
  };
}

const manifest: CrateExportManifest = {
  entries: [
    entry(),
    entry({
      trackId: "t2",
      stemId: "s2",
      stemType: "drums",
      title: "Saltwater",
      artistName: "Mira Okoye",
      licenseType: "personal",
      fileName: "Mira Okoye - Saltwater (Drums).mp3",
      bpm: null,
      key: null,
      camelot: null,
      firstBeatSec: null,
      hasCue: false,
    }),
  ],
  skipped: [
    { position: 2, trackId: "t3", title: "Glass Harbour", reason: "not_purchased" },
    { position: 3, trackId: "t4", title: "Paper Lanterns", reason: "no_export_right" },
  ],
  notes: ["The Serato crate lists the files only."],
};

function render(overrides: Partial<CrateExportViewProps> = {}) {
  return renderToStaticMarkup(
    <CrateExportView
      loadState="ready"
      loadError={null}
      manifest={manifest}
      folder=""
      placeholder="/Users/you/Music/Resonate"
      busy={null}
      notice={null}
      failedStems={[]}
      canDownload
      onFolderChange={vi.fn()}
      onDownloadStems={vi.fn()}
      onExport={vi.fn()}
      {...overrides}
    />,
  );
}

describe("CrateExportView", () => {
  it("lists the stems you own with their file names, license and measured facts", () => {
    const html = render();
    expect(html).toContain("Export to rekordbox or Serato");
    expect(html).toContain("Stems you can export (2)");
    expect(html).toContain("Neon Drift: Vocals");
    expect(html).toContain("Aya Volt · Commercial license");
    expect(html).toContain("128 BPM · Am (8A) · cue at 0.123 s");
    expect(html).toContain("Aya Volt - Neon Drift (Vocals).mp3");
    expect(html).toContain("Tempo not measured · Key not measured · no cue");
  });

  it("explains each skipped line in plain words", () => {
    const html = render();
    expect(html).toContain("Left out (2)");
    expect(html).toContain("Glass Harbour");
    expect(html).toContain("You do not own a stem of this track yet.");
    expect(html).toContain("Paper Lanterns");
    expect(html).toContain("no standard terms");
  });

  it("shows the folder field with its label, example and privacy note, and the format buttons", () => {
    const html = render({ folder: "/Users/you/Music/Resonate" });
    expect(html).toContain("Folder where you saved these files");
    expect(html).toContain('placeholder="/Users/you/Music/Resonate"');
    expect(html).toContain("It stays in this browser; Resonate does not keep it.");
    expect(html).toContain("rekordbox XML");
    expect(html).toContain("Serato crate");
    expect(html).toContain("File &gt; Import &gt; rekordbox xml");
    expect(html).toContain("_Serato_/Subcrates");
    expect(html).toContain("The Serato crate lists the files only.");
  });

  it("disables the format buttons until the folder is an absolute path", () => {
    const disabledButtons = (html: string) =>
      [...html.matchAll(/<button[^>]*>(rekordbox XML|Serato crate)<\/button>/g)].map((m) => /disabled/.test(m[0]));
    expect(disabledButtons(render({ folder: "" }))).toEqual([true, true]);
    expect(disabledButtons(render({ folder: "Music/Crates" }))).toEqual([true, true]);
    expect(render({ folder: "Music/Crates" })).toContain("Type the full path");
    expect(disabledButtons(render({ folder: "/Users/you/Music" }))).toEqual([false, false]);
    expect(disabledButtons(render({ folder: "C:\\Music" }))).toEqual([false, false]);
    // Busy downloading: nothing else starts.
    expect(
      disabledButtons(render({ folder: "/Users/you/Music", busy: { kind: "stems", done: 0, total: 2 } })),
    ).toEqual([true, true]);
  });

  it("says nothing is exportable yet, and still explains what was left out", () => {
    const html = render({ manifest: { entries: [], skipped: manifest.skipped, notes: [] } });
    expect(html).toContain("Nothing to export yet");
    expect(html).not.toContain("Download stems");
    expect(html).toContain("Left out (2)");
  });

  it("shows progress, failures and load problems", () => {
    expect(render({ busy: { kind: "stems", done: 1, total: 2 } })).toContain("Downloading stem 2 of 2");
    expect(render({ busy: { kind: "file", format: "serato" } })).toContain("Building your Serato crate");
    expect(render({ failedStems: [{ label: "Neon Drift: Vocals", message: "Download failed" }] })).toContain(
      "These stems could not be downloaded",
    );
    expect(render({ loadState: "error", loadError: "Could not load", manifest: null })).toContain("Could not load");
    expect(render({ loadState: "loading", manifest: null })).toContain("Checking which stems you own");
  });

  it("says the list comes from the saved crate while there are unsaved edits", () => {
    expect(render({ hasUnsavedChanges: true })).toContain("This list comes from your saved crate");
    expect(render()).not.toContain("This list comes from your saved crate");
  });

  it("asks to connect a wallet when there is none to download with", () => {
    expect(render({ canDownload: false })).toContain("Connect your wallet to download.");
  });
});
