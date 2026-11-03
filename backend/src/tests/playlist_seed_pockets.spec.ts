/**
 * The pattern of a playlist used as an AI DJ seed: pockets of genre family,
 * groove and mood, their shares, the fit nudge and the proportional order.
 * Pure: no database.
 */
import {
  interleaveByShare,
  playlistPattern,
  pocketFitBonus,
  pocketQuota,
  type PocketTrack,
} from "../modules/agents/playlist_seed_pockets";

function tracks(count: number, base: Omit<PocketTrack, "id">, prefix: string): PocketTrack[] {
  return Array.from({ length: count }, (_, index) => ({ ...base, id: `${prefix}${index}` }));
}

describe("playlistPattern", () => {
  it("keeps every genre-and-groove pocket on at least 10% of the playlist, with its share and moods", () => {
    const playlist = [
      ...tracks(10, { families: ["hip_hop"], energyBand: "high", moods: ["Dark", "Energetic"] }, "hh"),
      ...tracks(6, { families: ["african"], energyBand: "medium", moods: ["warm"] }, "af"),
      ...tracks(3, { families: ["jazz"], energyBand: "low", moods: [] }, "jz"),
      // One-offs: under 10% each, never a pocket.
      { id: "rock", families: ["rock"], energyBand: "high" },
    ];
    const pattern = playlistPattern(playlist);
    expect(pattern.proportional).toBe(true);
    expect(pattern.pockets.map((pocket) => [pocket.key, pocket.count])).toEqual([
      ["hip_hop|energy:high", 10],
      ["african|energy:medium", 6],
      ["jazz|energy:low", 3],
    ]);
    expect(pattern.pockets.map((pocket) => pocket.share)).toEqual([10 / 19, 6 / 19, 3 / 19]);
    expect(pattern.pockets[0].moods).toEqual(["dark", "energetic"]);
    expect(pattern.pockets[1].moods).toEqual(["warm"]);
    expect(pattern.pockets[0].trackIds).toHaveLength(10);
  });

  it("splits one genre by groove, and gathers grooves too small on their own into one 'any groove' pocket", () => {
    const playlist = [
      ...tracks(8, { families: ["hip_hop"], energyBand: "high" }, "hi"),
      ...tracks(6, { families: ["hip_hop"], energyBand: "low" }, "lo"),
      // Three small grooves of house (1 each, under 10%) and two unmeasured: 5 of 20 together.
      { id: "h1", families: ["house"], energyBand: "high" },
      { id: "h2", families: ["house"], energyBand: "low" },
      { id: "h3", families: ["house"], tempoBand: "fast" },
      ...tracks(2, { families: ["house"] }, "hn"),
      { id: "x", families: ["jazz"] },
    ];
    const pattern = playlistPattern(playlist);
    expect(pattern.pockets.map((pocket) => pocket.key)).toEqual([
      "hip_hop|energy:high",
      "hip_hop|energy:low",
      "house|any",
    ]);
    expect(pattern.pockets[2].groove).toBeNull();
  });

  it("uses the tempo band as the groove when energy was not measured", () => {
    const pattern = playlistPattern(tracks(4, { families: ["house"], tempoBand: "fast" }, "t"));
    expect(pattern.pockets).toEqual([
      expect.objectContaining({ key: "house|tempo:fast", groove: { kind: "tempo", band: "fast" }, share: 1 }),
    ]);
  });

  it("keeps at most five pockets, the largest first", () => {
    const families = ["a", "b", "c", "d", "e", "f"];
    const playlist = families.flatMap((family, index) =>
      // Every family is on more than 10%: a has 4 tracks, the others 3 each.
      tracks(index === 0 ? 4 : 3, { families: [family], energyBand: "medium" }, family));
    const pattern = playlistPattern(playlist);
    expect(pattern.pockets.map((pocket) => pocket.familyId)).toEqual(["a", "b", "c", "d", "e"]);
    expect(pattern.pockets.reduce((sum, pocket) => sum + pocket.share, 0)).toBeCloseTo(1);
  });

  it("falls back to the two most common families when nothing reaches 10%", () => {
    const playlist: PocketTrack[] = [
      ...Array.from({ length: 20 }, (_, index) => ({ id: `one${index}`, families: [`g${index}`] })),
      { id: "a2", families: ["g1"] },
    ];
    const pattern = playlistPattern(playlist, { minShare: 0.1 });
    expect(pattern.proportional).toBe(false);
    expect(pattern.pockets.map((pocket) => [pocket.familyId, pocket.groove])).toEqual([
      ["g1", null],
      ["g0", null],
    ]);
  });

  it("is empty for an empty playlist or one with no genre at all", () => {
    expect(playlistPattern([])).toEqual({ pockets: [], proportional: false });
    expect(playlistPattern([{ id: "t", families: [] }])).toEqual({ pockets: [], proportional: false });
  });
});

describe("pocketFitBonus", () => {
  const pocket = { groove: { kind: "energy" as const, band: "high" }, moods: ["dark", "energetic", "raw"] };

  it("nudges a candidate that shares the groove and moods, capped so the sound still leads", () => {
    expect(pocketFitBonus(pocket, { energyBand: "high", moods: ["Dark"] })).toBeCloseTo(0.08);
    expect(pocketFitBonus(pocket, { energyBand: "low", moods: ["dark", "energetic", "raw"] })).toBeCloseTo(0.06);
    expect(pocketFitBonus(pocket, { energyBand: null, tempoBand: "high", moods: [] })).toBe(0);
  });

  it("gives no groove nudge to an 'any groove' pocket", () => {
    expect(pocketFitBonus({ groove: null, moods: [] }, { energyBand: "high" })).toBe(0);
  });
});

describe("pocketQuota", () => {
  it("asks for the pocket's share, never fewer than the minimum", () => {
    expect(pocketQuota(0.5, 20)).toBe(10);
    expect(pocketQuota(0.05, 20)).toBe(3);
    expect(pocketQuota(0.3, 30, 5)).toBe(9);
  });
});

describe("interleaveByShare", () => {
  it("keeps each list's share in the order, so any cut keeps the mix", () => {
    const merged = interleaveByShare(
      [
        { share: 0.5, items: ["a1", "a2", "a3", "a4", "a5"] },
        { share: 0.3, items: ["b1", "b2", "b3"] },
        { share: 0.2, items: ["c1", "c2"] },
      ],
      (id) => id,
    );
    expect(merged.slice(0, 5)).toEqual(["a1", "b1", "c1", "a2", "b2"]);
    expect(merged.slice(0, 10).filter((id) => id.startsWith("a"))).toHaveLength(5);
    expect(merged).toHaveLength(10);
  });

  it("lets the others fill in when a list runs out, skips repeats, and gives a share-0 list last", () => {
    const merged = interleaveByShare(
      [
        { share: 0.8, items: ["a1", "shared"] },
        { share: 0.2, items: ["shared", "b1", "b2"] },
        { share: 0, items: ["rest"] },
      ],
      (id) => id,
    );
    expect(merged).toEqual(["a1", "shared", "b1", "b2", "rest"]);
  });
});
