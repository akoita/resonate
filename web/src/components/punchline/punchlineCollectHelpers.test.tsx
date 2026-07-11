import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  collectableDrops,
  describeCollectError,
  dropSetProgress,
  formatEditionsRemaining,
  momentCollectState,
  resolveClipUrl,
} from "./punchlineCollectHelpers";
import { CollectButton } from "./PunchlineCollectModule";
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
