import { describe, expect, it } from "vitest";
import { REPO_URL, describeBuildStamp } from "./buildInfo";

describe("describeBuildStamp", () => {
  it("shortens a commit SHA and links it to the commit", () => {
    const sha = "0DCF91A65196F90F1F00040FA34B532D1E859DBF";
    expect(describeBuildStamp(sha)).toEqual({
      label: "0dcf91a",
      href: `${REPO_URL}/commit/${sha}`,
    });
    expect(describeBuildStamp("0dcf91a")?.label).toBe("0dcf91a");
  });

  it("shows any other version as given, without a link", () => {
    expect(describeBuildStamp(" 0.1.0 ")).toEqual({ label: "0.1.0", href: null });
  });

  it("returns nothing for a missing stamp", () => {
    expect(describeBuildStamp("")).toBeNull();
    expect(describeBuildStamp(null)).toBeNull();
    expect(describeBuildStamp(undefined)).toBeNull();
  });
});
