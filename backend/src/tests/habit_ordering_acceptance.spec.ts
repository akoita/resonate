import { HabitOrderTrack, orderHabitTracks } from "../modules/agents/habit_ordering";

describe("habit ordering batch invariants", () => {
  it("preserves every object and duplicate ID across deterministic mixed batches", () => {
    // Exhaust the small lane/energy combinations with stable original ranks.
    const bands = ["low", "medium", "high"] as const;
    for (let seed = 0; seed < 81; seed += 1) {
      const tracks: HabitOrderTrack[] = Array.from({ length: 5 }, (_, rank) => ({
        id: `duplicate-${rank % 2}`,
        rank,
        laneId: (seed + rank) % 4 === 0 ? undefined : `lane-${(seed + rank) % 3}`,
        energyBand: bands[Math.floor(seed / (3 ** (rank % 4))) % 3],
        energySource: rank % 2 === 0 ? "measured" : "inferred",
      }));
      const state = {
        transitions: [
          { fromLaneId: "lane-0", toLaneId: "lane-1", good: 0, bad: 4, largeEnergyGood: 0 },
          { fromLaneId: "lane-0", toLaneId: "lane-2", good: 4, bad: 0, largeEnergyGood: 3 },
        ],
        previous: { laneId: "lane-0", runLength: seed % 5, energyBand: bands[seed % 3] },
      };
      const strengths = { "lane-0": 1, "lane-1": 0.8, "lane-2": 0.5 };
      const ordered = orderHabitTracks(tracks, state, strengths);
      expect(ordered).toHaveLength(tracks.length);
      expect(new Set(ordered)).toEqual(new Set(tracks));
      expect(ordered.map((track) => track.rank)).toEqual(orderHabitTracks(tracks, state, strengths).map((track) => track.rank));
      for (const track of ordered) expect(track).toBe(tracks[track.rank]);
      expect(tracks.map((track) => track.rank)).toEqual([0, 1, 2, 3, 4]);
    }
  });
});
