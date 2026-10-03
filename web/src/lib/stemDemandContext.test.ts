import { describe, expect, it } from "vitest";
import { ownedDemandTrack, stemDemandContext } from "./stemDemandContext";

describe("Scene Scout stem listing context", () => {
  it("accepts a categorical suggestion only for a track in the owner's release", () => {
    const context = stemDemandContext(new URLSearchParams("demandTrack=track-1&demandStem=vocals"));
    expect(context).toEqual({ trackId: "track-1", stemType: "vocals" });
    expect(ownedDemandTrack(context, [{ id: "track-1" }], true)).toEqual({ id: "track-1" });
    expect(ownedDemandTrack(context, [{ id: "other" }], true)).toBeUndefined();
    expect(ownedDemandTrack(context, [{ id: "track-1" }], false)).toBeUndefined();
  });
  it("accepts a supported license suggestion", () => {
    expect(stemDemandContext(new URLSearchParams("demandTrack=t&demandLicense=remix")))
      .toEqual({ trackId: "t", licenseType: "remix" });
  });
  it.each([
    "demandTrack=../private&demandStem=vocals", "demandTrack=t&demandTrack=x&demandStem=vocals",
    "demandTrack=t&demandStem=prompt", "demandTrack=t&demandStem=bass&demandStem=vocals",
    "demandTrack=t&demandStem=bass&demandLicense=remix", "demandTrack=t&demandLicense=unsupported",
    "demandTrack=t", "demandStem=vocals",
  ])("ignores malformed context: %s", (query) => {
    expect(stemDemandContext(new URLSearchParams(query))).toBeUndefined();
  });
});
