import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("../auth/AuthProvider", () => ({ useAuth: () => ({ token: "t" }) }));
vi.mock("../ui/Toast", () => ({ useToast: () => ({ addToast: vi.fn() }) }));
vi.mock("../../styles/stem-pricing.css", () => ({}));

import { OfficialStemsPanel } from "./OfficialStemsPanel";

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
    expect(html).toContain("Official: vocals, bass");
    expect(html).toContain("Replace official stems");
  });

  it("is hidden while the release is still processing", () => {
    expect(renderToStaticMarkup(<OfficialStemsPanel releaseId="r1" releaseStatus="processing" tracks={tracks} />)).toBe("");
    expect(renderToStaticMarkup(<OfficialStemsPanel releaseId="r1" releaseStatus="ready" tracks={[]} />)).toBe("");
  });
});
