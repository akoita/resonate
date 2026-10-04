import {
  findPendingCompletion,
  orderPending,
  PENDING_LIMIT,
  RESONANCE_FOLLOW_UP_DAYS,
} from "../modules/discovery_journal/discovery_journal.service";

const NOW = new Date("2026-06-15T12:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY);

const complete = (at: Date, ratio?: number) => ({
  action: "complete",
  createdAt: at,
  metadata: ratio === undefined ? {} : { outcome: { completionRatio: ratio } },
});

describe("findPendingCompletion", () => {
  it("returns the completion and a follow-up deadline 7 days later", () => {
    const at = daysAgo(2);
    const result = findPendingCompletion({ events: [complete(at, 0.95)], now: NOW });
    expect(result).toEqual({
      completedAt: at,
      followUpBy: new Date(at.getTime() + RESONANCE_FOLLOW_UP_DAYS * DAY),
    });
  });

  it("picks the LATEST qualifying completion", () => {
    const result = findPendingCompletion({
      events: [complete(daysAgo(5), 1), complete(daysAgo(1), 0.9), complete(daysAgo(3), 1)],
      now: NOW,
    });
    expect(result?.completedAt).toEqual(daysAgo(1));
  });

  it("ignores low, missing and non-complete completions", () => {
    expect(
      findPendingCompletion({
        events: [
          complete(daysAgo(1), 0.89),
          complete(daysAgo(1)),
          { action: "replay", createdAt: daysAgo(1), metadata: { outcome: { completionRatio: 1 } } },
        ],
        now: NOW,
      }),
    ).toBeNull();
  });

  it("only looks at (now - 7 days, now]", () => {
    expect(findPendingCompletion({ events: [complete(daysAgo(7), 1)], now: NOW })).toBeNull();
    expect(
      findPendingCompletion({ events: [complete(new Date(daysAgo(7).getTime() + 1), 1)], now: NOW }),
    ).not.toBeNull();
    expect(
      findPendingCompletion({ events: [complete(new Date(NOW.getTime() + 1), 1)], now: NOW }),
    ).toBeNull();
    expect(findPendingCompletion({ events: [complete(NOW, 1)], now: NOW })).not.toBeNull();
  });

  it("returns null without events", () => {
    expect(findPendingCompletion({ events: [], now: NOW })).toBeNull();
  });
});

describe("orderPending", () => {
  it("orders by completion desc, then track id asc, and caps at PENDING_LIMIT", () => {
    const entries = [
      { trackId: "b", completedAt: daysAgo(1) },
      { trackId: "a", completedAt: daysAgo(1) },
      { trackId: "c", completedAt: daysAgo(2) },
    ];
    expect(orderPending(entries).map((entry) => entry.trackId)).toEqual(["a", "b", "c"]);

    const many = Array.from({ length: PENDING_LIMIT + 5 }, (_, index) => ({
      trackId: `t${String(index).padStart(2, "0")}`,
      completedAt: new Date(NOW.getTime() - index * 1000),
    }));
    const capped = orderPending(many);
    expect(capped).toHaveLength(PENDING_LIMIT);
    expect(capped[0].trackId).toBe("t00");
  });
});
