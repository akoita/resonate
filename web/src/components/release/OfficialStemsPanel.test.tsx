import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ token: "t" }) }));
vi.mock("../ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock("../../styles/stem-pricing.css", () => ({}));

import { OfficialStemsPanel, OfficialStemsUploadForm } from "./OfficialStemsPanel";

const tracks = [
  { trackId: "t1", trackTitle: "Night Drive", officialTypes: [] as string[] },
  { trackId: "t2", trackTitle: "Day Drive", officialTypes: ["vocals", "bass"] },
];

describe("OfficialStemsPanel (#1976)", () => {
  it("offers an upload per track and explains Official vs Separated (AI)", () => {
    const html = renderToStaticMarkup(<OfficialStemsPanel releaseId="r1" releaseStatus="published" tracks={tracks} />);
    expect(html).toContain("Official stems");
    expect(html).toContain("WAV or FLAC");
    expect(html).toContain(">Official<");
    expect(html).toContain(">Separated (AI)<");
    expect(html).toContain("Night Drive");
    expect(html).toContain("No official stems yet");
    expect(html).toContain("Upload official stems");
    // Official parts are chips, not a sentence; a track with none says so.
    expect(html).toContain('class="official-stems-chip">Vocals<');
    expect(html).toContain('class="official-stems-chip">Bass<');
    expect(html).not.toContain("Official: vocals");
    expect(html).toContain("Replace official stems");
    // The app's button classes, not browser-default buttons.
    expect(html).toContain('class="ui-btn ui-btn-sm ui-btn-primary"');
    expect(html).toContain('class="ui-btn ui-btn-sm ui-btn-ghost"');
  });

  it("is hidden while the release is still processing", () => {
    expect(renderToStaticMarkup(<OfficialStemsPanel releaseId="r1" releaseStatus="processing" tracks={tracks} />)).toBe("");
    expect(renderToStaticMarkup(<OfficialStemsPanel releaseId="r1" releaseStatus="ready" tracks={[]} />)).toBe("");
  });
});

describe("OfficialStemsUploadForm (#2379)", () => {
  const noop = () => undefined;
  const props = {
    files: {},
    issues: [],
    fileErrors: {},
    error: null,
    uploading: false,
    inputKeys: {},
    onChoose: noop,
    onSubmit: noop,
    onCancel: noop,
  };
  const file = (name: string, bytes: number) => ({ name, size: bytes }) as File;

  it("starts with one picker row per stem type and a disabled primary Upload", () => {
    const html = renderToStaticMarkup(<OfficialStemsUploadForm {...props} />);
    for (const type of ["vocals", "drums", "bass", "guitar", "piano", "other"]) {
      expect(html).toContain(`data-stem-type="${type}"`);
    }
    expect((html.match(/WAV or FLAC, up to 300 MB each/g) ?? []).length).toBe(6);
    expect(html).toContain("Choose file");
    expect(html).toMatch(/<button type="button" class="ui-btn ui-btn-primary" disabled="">Upload<\/button>/);
    expect(html).not.toContain("official-stems-row__remove");
    // No unstyled native file chooser: the input is hidden behind the picker button.
    expect(html).toContain("official-stems-row__input");
  });

  it("shows each chosen file with its size and a remove control, and enables Upload", () => {
    const html = renderToStaticMarkup(
      <OfficialStemsUploadForm {...props} files={{ vocals: file("night-vocals.wav", 31.4 * 1024 * 1024), bass: file("bass.flac", 850 * 1024) }} />,
    );
    expect(html).toContain("night-vocals.wav");
    expect(html).toContain("31.4 MB");
    expect(html).toContain("850 KB");
    expect(html).toContain('aria-label="Remove the vocals file"');
    expect(html).toContain('aria-label="Remove the bass file"');
    expect(html).not.toContain('aria-label="Remove the drums file"');
    expect(html).toContain("Change");
    expect(html).toMatch(/class="ui-btn ui-btn-primary"[^>]*>Upload 2 parts</);
    expect(html).not.toMatch(/ui-btn-primary" disabled/);
  });

  it("puts a refusal reason under its own row and the rest above the rows", () => {
    const html = renderToStaticMarkup(
      <OfficialStemsUploadForm
        {...props}
        files={{ vocals: file("v.wav", 1024), bass: file("b.wav", 1024) }}
        issues={[
          { stemType: "vocals", message: "The vocals (v.wav) file matches the mix about 0.7 s later than where it sits." },
          { message: "The stems use different sample rates." },
        ]}
        fileErrors={{ drums: "d.mp3 must be a WAV or FLAC file." }}
      />,
    );
    const vocalsRow = html.slice(html.indexOf('data-stem-type="vocals"'), html.indexOf('data-stem-type="drums"'));
    expect(vocalsRow).toContain("0.7 s later");
    expect(vocalsRow).toContain("official-stems-row--refused");
    const bassRow = html.slice(html.indexOf('data-stem-type="bass"'), html.indexOf('data-stem-type="guitar"'));
    expect(bassRow).not.toContain("0.7 s later");
    const drumsRow = html.slice(html.indexOf('data-stem-type="drums"'), html.indexOf('data-stem-type="bass"'));
    expect(drumsRow).toContain("d.mp3 must be a WAV or FLAC file.");
    expect(html.indexOf("The stems use different sample rates.")).toBeLessThan(html.indexOf('data-stem-type="vocals"'));
  });

  it("locks the form while uploading", () => {
    const html = renderToStaticMarkup(<OfficialStemsUploadForm {...props} uploading files={{ vocals: file("v.wav", 1024) }} />);
    expect(html).toContain("Checking and uploading…");
    expect(html).toMatch(/class="ui-btn ui-btn-primary" disabled/);
    expect(html).toMatch(/class="ui-btn ui-btn-ghost" disabled="">Cancel/);
  });
});
