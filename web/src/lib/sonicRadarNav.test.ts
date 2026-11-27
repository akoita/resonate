import { describe, expect, it } from "vitest";
import { journalHasDiscoveries } from "./sonicRadarNav";
import type { DiscoveryJournal } from "./api";

const empty: DiscoveryJournal = {
  schemaVersion: "discovery-journal/v1",
  window: { days: 7, from: "", to: "" },
  headline: { resonantDiscoveriesThisWeek: 0, newArtistsThisWeek: 0 },
  groups: [],
  pending: [],
  newFromDiscovered: [],
};

describe("journalHasDiscoveries", () => {
  it("is false for no journal and for an empty one", () => {
    expect(journalHasDiscoveries(null)).toBe(false);
    expect(journalHasDiscoveries(empty)).toBe(false);
    expect(journalHasDiscoveries({ ...empty, pending: undefined, newFromDiscovered: undefined })).toBe(false);
  });

  it("is true with a resonant discovery, a track one save away, or a new release", () => {
    expect(journalHasDiscoveries({ ...empty, headline: { resonantDiscoveriesThisWeek: 1, newArtistsThisWeek: 0 } })).toBe(true);
    expect(journalHasDiscoveries({ ...empty, pending: [{} as never] })).toBe(true);
    expect(journalHasDiscoveries({ ...empty, newFromDiscovered: [{} as never] })).toBe(true);
    expect(journalHasDiscoveries({ ...empty, groups: [{ items: [{}] } as never] })).toBe(true);
  });
});
