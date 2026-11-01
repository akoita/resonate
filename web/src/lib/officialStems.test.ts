import { describe, expect, it } from "vitest";
import { ApiRequestError } from "./api";
import { OFFICIAL_STEMS_FORM_HINT, describeOfficialStemUpload, formatFileSize, officialStemRejectionIssues, officialStemWithdrawMessage, stemTypeLabel } from "./officialStems";

const stem = (type: string) => ({ id: `s_${type}`, type, source: "official" as const, mimeType: "audio/wav", durationSeconds: 200 });

describe("official stem upload messages (#2379)", () => {
  it("lists every part reason of a refused package", () => {
    const error = new ApiRequestError("API 400: first (and 1 more problem)", 400, {
      code: "official_stems_rejected",
      message: "first",
      issues: [
        { code: "misaligned", stemType: "vocals", message: "The vocals (v.wav) file does not line up." },
        { code: "duration_mismatch", stemType: "bass", message: "The bass (b.wav) file is 150.0 s long." },
      ],
    });
    expect(officialStemRejectionIssues(error)).toEqual([
      { stemType: "vocals", message: "The vocals (v.wav) file does not line up." },
      { stemType: "bass", message: "The bass (b.wav) file is 150.0 s long." },
    ]);
  });

  it("gives nothing for any other failure", () => {
    expect(officialStemRejectionIssues(new Error("boom"))).toEqual([]);
    expect(officialStemRejectionIssues(new ApiRequestError("x", 403, { code: "official_stems_forbidden" }))).toEqual([]);
    expect(officialStemRejectionIssues(new ApiRequestError("x", 400, { code: "official_stems_rejected", issues: "nope" }))).toEqual([]);
    expect(officialStemRejectionIssues(new ApiRequestError("x", 400, undefined))).toEqual([]);
    expect(
      officialStemRejectionIssues(new ApiRequestError("x", 400, { code: "official_stems_rejected", issues: [null, { message: "" }, { message: "ok" }] })),
    ).toEqual([{ message: "ok" }]);
  });

  it("says what was added, what was replaced and what stays on sale", () => {
    expect(describeOfficialStemUpload({ stems: [stem("bass")], replaced: 0, kept: [] })).toBe(
      "Added bass. Buyers see it as Official, in lossless quality.",
    );
    expect(describeOfficialStemUpload({ stems: [stem("vocals"), stem("drums")], replaced: 1, kept: ["bass"] })).toBe(
      "Added vocals, drums. Buyers see them as Official, in lossless quality. It replaces the earlier official part of the same type. Your official bass stays on sale.",
    );
    expect(describeOfficialStemUpload({ stems: [stem("vocals")], replaced: 2, kept: ["bass", "drums"] })).toContain(
      "They replace the earlier official parts of the same type. Your official bass, drums stay on sale.",
    );
    expect(describeOfficialStemUpload({ stems: [stem("vocals")], replaced: 0 })).not.toContain("replace");
  });

  it("tells the artist one part is enough and that other parts stay on sale", () => {
    expect(OFFICIAL_STEMS_FORM_HINT).toContain("one is enough");
    expect(OFFICIAL_STEMS_FORM_HINT).toContain("other parts stay on sale");
    expect(OFFICIAL_STEMS_FORM_HINT).not.toMatch(/full set/i);
  });

  it("formats file sizes and stem labels for the picker rows", () => {
    expect(formatFileSize(0)).toBe("0 KB");
    expect(formatFileSize(512)).toBe("1 KB");
    expect(formatFileSize(850 * 1024)).toBe("850 KB");
    expect(formatFileSize(12.34 * 1024 * 1024)).toBe("12.3 MB");
    expect(formatFileSize(240 * 1024 * 1024)).toBe("240 MB");
    expect(stemTypeLabel("vocals")).toBe("Vocals");
  });
});

describe("withdrawing an official part (#2379)", () => {
  it("says what comes off sale, what stays, and that a minted part is locked", () => {
    const message = officialStemWithdrawMessage("vocals", "Night Drive");
    expect(message).toContain('official vocals part of "Night Drive" comes off sale');
    expect(message).toContain("already licensed it keep their files");
    expect(message).toContain("separated (AI) vocals stem");
    expect(message).toContain("minted cannot be withdrawn");
  });
});
