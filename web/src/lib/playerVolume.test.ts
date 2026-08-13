import { describe, expect, it } from "vitest";
import { setPlayerVolume, togglePlayerMute } from "./playerVolume";

describe("player volume state", () => {
  it("mutes without forgetting the previous audible level", () => {
    expect(togglePlayerMute({ volume: 0.35, muted: false, previousNonZeroVolume: 0.35 }))
      .toEqual({ volume: 0, muted: true, previousNonZeroVolume: 0.35 });
  });

  it("restores the previous non-zero volume when unmuting", () => {
    expect(togglePlayerMute({ volume: 0, muted: true, previousNonZeroVolume: 0.35 }))
      .toEqual({ volume: 0.35, muted: false, previousNonZeroVolume: 0.35 });
  });

  it("keeps slider changes synchronized and clamps invalid values", () => {
    const audible = setPlayerVolume({ volume: 0, muted: true, previousNonZeroVolume: 0.4 }, 0.7);
    expect(audible).toEqual({ volume: 0.7, muted: false, previousNonZeroVolume: 0.7 });
    expect(setPlayerVolume(audible, 2).volume).toBe(1);
    expect(setPlayerVolume(audible, Number.NaN)).toEqual({
      volume: 0,
      muted: true,
      previousNonZeroVolume: 0.7,
    });
  });
});
