import { describe, expect, it } from "vitest";
import { newPlaylistTrackRefs } from "./playlistStore";

describe("newPlaylistTrackRefs", () => {
  it("treats a track as present when the playlist holds either of its ids", () => {
    // The playlist holds the catalog id; the library row drags its library id.
    expect(newPlaylistTrackRefs(["trk_1"], [{ id: "lib-1", catalogTrackId: "trk_1" }])).toEqual([]);
    // And the other way round.
    expect(newPlaylistTrackRefs(["lib-1"], [{ id: "trk_1", catalogTrackId: null }, { id: "lib-1" }])).toEqual([
      { id: "trk_1", catalogTrackId: null },
    ]);
  });

  it("drops duplicates inside one batch and keeps genuinely new tracks in order", () => {
    expect(
      newPlaylistTrackRefs(["a"], [
        { id: "lib-2", catalogTrackId: "trk_2" },
        { id: "trk_2" },
        { id: "a" },
        { id: "lib-3" },
      ]),
    ).toEqual([{ id: "lib-2", catalogTrackId: "trk_2" }, { id: "lib-3" }]);
  });
});
