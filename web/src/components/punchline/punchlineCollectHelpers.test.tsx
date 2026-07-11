import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  collectableDrops,
  describeCollectError,
  dropSetProgress,
  formatCollectSummaryValue,
  formatEditionsRemaining,
  momentCollectState,
  resolveClipUrl,
  summarizeCollectableDrops,
} from "./punchlineCollectHelpers";
import { CollectButton } from "./PunchlineCollectModule";
import {
  PunchlineInventory,
  formatAcquiredAt,
  groupCollectiblesByDrop,
} from "./PunchlineInventory";
import type { PunchlineCollectibleItem } from "../../lib/api";
import { API_BASE, type PunchlineDrop, type PunchlineMoment } from "../../lib/api";

function moment(overrides: Partial<PunchlineMoment> = {}): PunchlineMoment {
  return {
    id: "m1",
    title: "Hook",
    lyricText: "The punchline",
    artworkUrl: null,
    sourceStemType: "vocals",
    startMs: 1000,
    endMs: 6000,
    clipAssetUri: "/catalog/stems/clip.mp3/blob",
    editionSize: 100,
    priceCents: 0,
    rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
    collectedCount: 0,
    ...overrides,
  };
}

function drop(overrides: Partial<PunchlineDrop> = {}): PunchlineDrop {
  return {
    id: "d1",
    trackId: "t1",
    artistId: "a1",
    status: "published",
    title: "Drop",
    description: null,
    createdAt: "2026-07-11T00:00:00.000Z",
    updatedAt: "2026-07-11T00:00:00.000Z",
    publishedAt: "2026-07-11T00:00:00.000Z",
    rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
    rightsSummary: "Personal collectible only.",
    moments: [moment()],
    ...overrides,
  };
}

describe("resolveClipUrl", () => {
  it("passes absolute URLs through and prefixes relative paths with API_BASE", () => {
    expect(resolveClipUrl("https://storage.googleapis.com/b/clip.mp3")).toBe(
      "https://storage.googleapis.com/b/clip.mp3",
    );
    expect(resolveClipUrl("/catalog/stems/clip.mp3/blob")).toBe(
      `${API_BASE}/catalog/stems/clip.mp3/blob`,
    );
    expect(resolveClipUrl("catalog/x.mp3")).toBe(`${API_BASE}/catalog/x.mp3`);
  });

  it("returns null for missing or blank uris", () => {
    expect(resolveClipUrl(null)).toBeNull();
    expect(resolveClipUrl("   ")).toBeNull();
  });
});

describe("momentCollectState", () => {
  const base = {
    momentId: "m1",
    ownedMomentIds: new Set<string>(),
    signedIn: true,
  };

  it("owned wins over everything", () => {
    expect(
      momentCollectState({
        ...base,
        ownedMomentIds: new Set(["m1"]),
        moment: moment({ collectedCount: 100, priceCents: 500 }),
      }),
    ).toBe("owned");
  });

  it("sold out wins over price", () => {
    expect(
      momentCollectState({
        ...base,
        moment: moment({ collectedCount: 100, priceCents: 500 }),
      }),
    ).toBe("sold_out");
  });

  it("paid moments are pending; free moments collect or ask to sign in", () => {
    expect(
      momentCollectState({ ...base, moment: moment({ priceCents: 150 }) }),
    ).toBe("paid_pending");
    expect(momentCollectState({ ...base, moment: moment() })).toBe(
      "collectable",
    );
    expect(
      momentCollectState({ ...base, signedIn: false, moment: moment() }),
    ).toBe("sign_in");
  });
});

describe("formatEditionsRemaining", () => {
  it("counts down and reads sold out at zero", () => {
    expect(formatEditionsRemaining(100, 3)).toBe("97 of 100 left");
    expect(formatEditionsRemaining(2, 2)).toBe("Sold out");
    expect(formatEditionsRemaining(2, 5)).toBe("Sold out");
  });
});

describe("collectableDrops / dropSetProgress", () => {
  it("keeps only published drops that have moments", () => {
    const drops = [
      drop({ id: "keep" }),
      drop({ id: "empty", moments: [] }),
      drop({ id: "draft", status: "draft" }),
    ];
    expect(collectableDrops(drops).map((d) => d.id)).toEqual(["keep"]);
  });

  it("computes set progress only when signed in", () => {
    const d = drop({
      moments: [moment({ id: "a" }), moment({ id: "b" })],
    });
    expect(dropSetProgress(d, new Set(["a"]), false)).toBeNull();
    expect(dropSetProgress(d, new Set(["a"]), true)).toEqual({
      owned: 1,
      total: 2,
      complete: false,
    });
    expect(dropSetProgress(d, new Set(["a", "b"]), true)).toEqual({
      owned: 2,
      total: 2,
      complete: true,
    });
  });
});

describe("describeCollectError", () => {
  it("maps stable codes onto readable messages and state nudges", () => {
    expect(describeCollectError(new Error("sold_out: gone"))).toMatchObject({
      becameState: "sold_out",
    });
    expect(
      describeCollectError(new Error("already_collected")),
    ).toMatchObject({ becameState: "owned" });
    expect(
      describeCollectError(new Error("payment_rail_pending")),
    ).toMatchObject({ becameState: "paid_pending" });
    expect(describeCollectError(new Error("boom"))).toMatchObject({
      becameState: null,
    });
  });
});

describe("CollectButton states", () => {
  const render = (state: Parameters<typeof CollectButton>[0]["state"]) =>
    renderToStaticMarkup(
      <CollectButton
        state={state}
        editionNumber={null}
        busy={false}
        onCollect={() => undefined}
      />,
    );

  it("renders each state with an honest label", () => {
    expect(render("collectable")).toContain("Collect free");
    expect(render("sign_in")).toContain("Sign in to collect");
    expect(render("owned")).toContain("Owned");
    expect(render("sold_out")).toContain("Sold out");
    const paid = render("paid_pending");
    expect(paid).toContain("Coming soon");
    expect(paid).toContain("aria-disabled");
  });
});

describe("collect summary (above-the-fold discovery)", () => {
  it("aggregates drops and moments across tracks", () => {
    const byTrack = new Map([
      ["t1", [drop({ moments: [moment({ id: "a" }), moment({ id: "b" })] })]],
      ["t2", [drop({ id: "d2", moments: [moment({ id: "c" })] })]],
      ["t3", []],
    ]);
    expect(summarizeCollectableDrops(byTrack)).toEqual({
      dropCount: 2,
      momentCount: 3,
    });
    expect(summarizeCollectableDrops(new Map())).toEqual({
      dropCount: 0,
      momentCount: 0,
    });
  });

  it("formats the strip cell value with singular/plural", () => {
    expect(formatCollectSummaryValue({ dropCount: 1, momentCount: 1 })).toBe(
      "1 moment",
    );
    expect(formatCollectSummaryValue({ dropCount: 2, momentCount: 3 })).toBe(
      "3 moments",
    );
  });
});

function collectible(
  overrides: Partial<PunchlineCollectibleItem> = {},
): PunchlineCollectibleItem {
  return {
    id: "c1",
    editionNumber: 4,
    editionSize: 100,
    acquiredAt: "2026-07-11T10:00:00.000Z",
    paymentRail: "free_claim",
    pricePaidCents: 0,
    moment: {
      id: "m1",
      title: "Hook",
      lyricText: "The punchline",
      artworkUrl: null,
      startMs: 1000,
      endMs: 6000,
      clipAssetUri: "/catalog/stems/clip.mp3/blob",
      rightsLabel: "NON_COMMERCIAL_COLLECTIBLE",
    },
    drop: {
      id: "d1",
      title: "Drop One",
      trackId: "t1",
      trackTitle: "Track One",
      releaseId: "r1",
      artistId: "a1",
      artistName: "The Artist",
      momentCount: 2,
    },
    ...overrides,
  };
}

describe("inventory grouping (#487)", () => {
  it("groups by drop and computes set completion", () => {
    const items = [
      collectible({ id: "c1", moment: { ...collectible().moment, id: "m1" } }),
      collectible({ id: "c2", moment: { ...collectible().moment, id: "m2" } }),
      collectible({
        id: "c3",
        drop: { ...collectible().drop, id: "d2", title: "Solo", momentCount: 3 },
      }),
    ];
    const groups = groupCollectiblesByDrop(items);
    expect(groups).toHaveLength(2);
    const first = groups.find((g) => g.dropId === "d1")!;
    expect(first.items).toHaveLength(2);
    expect(first.complete).toBe(true);
    const second = groups.find((g) => g.dropId === "d2")!;
    expect(second.items).toHaveLength(1);
    expect(second.complete).toBe(false);
  });

  it("formats acquisition dates and tolerates bad input", () => {
    expect(formatAcquiredAt("2026-07-11T10:00:00.000Z")).toMatch(/^Acquired /);
    expect(formatAcquiredAt(null)).toBeNull();
    expect(formatAcquiredAt("not-a-date")).toBeNull();
  });
});

describe("PunchlineInventory states", () => {
  it("renders the signed-out and empty states", () => {
    const signedOut = renderToStaticMarkup(
      <PunchlineInventory items={[]} loading={false} signedIn={false} />,
    );
    expect(signedOut).toContain("Sign in");

    const empty = renderToStaticMarkup(
      <PunchlineInventory items={[]} loading={false} signedIn={true} />,
    );
    expect(empty).toContain("No moments yet");
    expect(empty).toContain("/catalog");
  });

  it("renders owned cards with edition, set progress, and release link", () => {
    const html = renderToStaticMarkup(
      <PunchlineInventory
        items={[collectible()]}
        loading={false}
        signedIn={true}
      />,
    );
    expect(html).toContain("Edition #4 of 100");
    expect(html).toContain("You own 1 of 2");
    expect(html).toContain("/release/r1");
    expect(html).toContain("The Artist");
  });
});
