import {
  NEW_RELEASES_LIMIT,
  NEW_RELEASES_PER_ARTIST,
  selectNewReleases,
} from "../modules/discovery_journal/discovery_journal.service";

const DAY = 24 * 60 * 60 * 1000;
const NOW = new Date("2026-06-15T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const entry = (trackId: string, artistId: string, ageDays: number, position = 1) => ({
  trackId,
  artistId,
  releaseCreatedAt: daysAgo(ageDays),
  position,
});

describe("selectNewReleases", () => {
  it("orders newest release first, then position, then track id", () => {
    const result = selectNewReleases([
      entry("c", "A", 5),
      entry("b2", "B", 2, 2),
      entry("b1", "B", 2, 1),
      entry("a", "C", 2, 2),
      entry("z", "D", 9),
    ]);
    expect(result.map((item) => item.trackId)).toEqual(["b1", "a", "b2", "c", "z"]);
  });

  it("breaks full ties by track id, whatever the input order", () => {
    const entries = [entry("t3", "A", 1), entry("t1", "B", 1), entry("t2", "C", 1)];
    expect(selectNewReleases(entries).map((item) => item.trackId)).toEqual(["t1", "t2", "t3"]);
    expect(selectNewReleases([...entries].reverse()).map((item) => item.trackId)).toEqual([
      "t1",
      "t2",
      "t3",
    ]);
  });

  it("keeps at most NEW_RELEASES_PER_ARTIST tracks per artist, the newest ones", () => {
    expect(NEW_RELEASES_PER_ARTIST).toBe(2);
    const result = selectNewReleases([
      entry("a-old", "A", 10),
      entry("a-new", "A", 1),
      entry("a-mid", "A", 5),
      entry("b", "B", 20),
    ]);
    expect(result.map((item) => item.trackId)).toEqual(["a-new", "a-mid", "b"]);
  });

  it("does not let a capped artist use up the total cap", () => {
    const result = selectNewReleases(
      [
        entry("a1", "A", 1),
        entry("a2", "A", 2),
        entry("a3", "A", 3),
        entry("b1", "B", 4),
        entry("c1", "C", 5),
      ],
      3,
    );
    expect(result.map((item) => item.trackId)).toEqual(["a1", "a2", "b1"]);
  });

  it("caps the total at NEW_RELEASES_LIMIT, newest first", () => {
    const entries = Array.from({ length: NEW_RELEASES_LIMIT + 5 }, (_, index) =>
      entry(`t${String(index).padStart(2, "0")}`, `artist${index}`, index + 1),
    );
    const result = selectNewReleases(entries);
    expect(result).toHaveLength(NEW_RELEASES_LIMIT);
    expect(result[0].trackId).toBe("t00");
    expect(result[NEW_RELEASES_LIMIT - 1].trackId).toBe(`t${NEW_RELEASES_LIMIT - 1}`);
  });

  it("does not mutate its input and keeps extra fields", () => {
    const entries = [{ ...entry("b", "B", 5), extra: 1 }, { ...entry("a", "A", 1), extra: 2 }];
    const copy = [...entries];
    const result = selectNewReleases(entries);
    expect(entries).toEqual(copy);
    expect(result[0]).toMatchObject({ trackId: "a", extra: 2 });
  });

  it("returns an empty list for no candidates", () => {
    expect(selectNewReleases([])).toEqual([]);
  });
});
