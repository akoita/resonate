import { describe, expect, it } from "vitest";
import { describeQueueResult } from "./queueFeedback";
import type { QueueBatchResult } from "./playerQueue";
import type { LocalTrack } from "./localLibrary";

const track = (id: string, title: string) => ({ id, title }) as LocalTrack;

const result = (
  added: LocalTrack[],
  skipped: LocalTrack[],
  queue: LocalTrack[],
): QueueBatchResult => ({ added, skipped, queue });

describe("describeQueueResult", () => {
  it("names the track and the resulting queue length for a single add", () => {
    const feedback = describeQueueResult(
      result([track("a", "Midnight Run")], [], [track("z", "Older"), track("a", "Midnight Run")]),
      "queue",
    );

    expect(feedback.type).toBe("success");
    expect(feedback.title).toBe("Added to queue");
    expect(feedback.message).toBe("“Midnight Run” · 2 tracks in queue");
  });

  it("says where a play-next track landed rather than counting it", () => {
    const feedback = describeQueueResult(
      result([track("a", "Midnight Run")], [], [track("a", "Midnight Run")]),
      "next",
    );

    expect(feedback.title).toBe("Up next");
    expect(feedback.message).toBe("“Midnight Run” plays after the current track.");
  });

  it("reports batches with the queue total and any duplicates", () => {
    const feedback = describeQueueResult(
      result(
        [track("a", "A"), track("b", "B")],
        [track("c", "C")],
        [track("a", "A"), track("b", "B"), track("c", "C")],
      ),
      "queue",
    );

    expect(feedback.title).toBe("2 tracks queued");
    expect(feedback.message).toBe("3 tracks in queue · 1 already there");
  });

  it("drops the duplicate clause when nothing was skipped", () => {
    const feedback = describeQueueResult(
      result([track("a", "A"), track("b", "B")], [], [track("a", "A"), track("b", "B")]),
      "next",
    );

    expect(feedback.title).toBe("2 tracks up next");
    expect(feedback.message).toBe("2 tracks in queue");
  });

  it("stays informational when everything was already queued", () => {
    const feedback = describeQueueResult(
      result([], [track("a", "Midnight Run")], [track("a", "Midnight Run")]),
      "queue",
    );

    expect(feedback.type).toBe("info");
    expect(feedback.title).toBe("Already lined up");
    expect(feedback.message).toBe("“Midnight Run” is already in your queue.");
  });

  it("covers the playing-or-next case for a skipped play-next track", () => {
    const feedback = describeQueueResult(
      result([], [track("a", "Midnight Run")], [track("a", "Midnight Run")]),
      "next",
    );

    expect(feedback.message).toBe("“Midnight Run” is playing or already up next.");
  });

  it("summarizes a fully duplicate batch", () => {
    const feedback = describeQueueResult(
      result([], [track("a", "A"), track("b", "B")], [track("a", "A"), track("b", "B")]),
      "queue",
    );

    expect(feedback.message).toBe("All 2 tracks are already in your queue.");
  });

  it("explains an empty request instead of announcing a no-op success", () => {
    const feedback = describeQueueResult(result([], [], []), "queue");

    expect(feedback.type).toBe("info");
    expect(feedback.title).toBe("Nothing to queue");
    expect(feedback.message).toBe("There are no playable tracks here.");
  });
});
