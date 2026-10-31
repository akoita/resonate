import { describe, expect, it } from "vitest";
import {
  COLLECT_SALE_CLAIM,
  DROP_SALE_CLAIM,
  collectedMomentShareMessage,
  collectedMomentShareUrl,
  dropPriceSummary,
  dropShareMessage,
  dropShareUrl,
  withCollectibleUtm,
  type CollectedMomentShareInput,
  type DropShareInput,
  type ShareChannel,
} from "./collectibleShare";
import { REDDIT_TITLE_MAX_LENGTH, X_MAX_LENGTH, xPostLength } from "./listeningShare";

const CHANNELS: ShareChannel[] = ["x", "facebook", "reddit", "native", "copy"];
const long = (seed: string) => `${seed} `.repeat(60).slice(0, 240);

/** ADR-BM-4: collectibles are utility, not yield. */
const YIELD_WORDING =
  /invest|value|apprecia|royalt|income|yield|profit|earn|return|dividend|passive|resell|flip|\broi\b/i;

const freeCollect: CollectedMomentShareInput = {
  lyricText: "This is the punchline everyone quotes",
  artistName: "Felicia Farerre",
  trackTitle: "Love Will Find You",
  editionNumber: 7,
  editionSize: 50,
  pricePaidCents: 0,
  editionsLeft: 12,
};
const paidCollect: CollectedMomentShareInput = { ...freeCollect, pricePaidCents: 250 };

const moment = (priceCents: number, collectedCount = 0, editionSize = 10) => ({
  priceCents,
  collectedCount,
  editionSize,
});
const freeDrop: DropShareInput = {
  dropTitle: "Hooks of the Summer",
  trackTitle: "Love Will Find You",
  artistName: "Felicia Farerre",
  moments: [moment(0), moment(0, 3)],
};
const paidDrop: DropShareInput = { ...freeDrop, moments: [moment(150), moment(300)] };

/** The post body per channel: Reddit's title, every other channel's text. */
function bodies(build: (channel: ShareChannel) => { title: string; text: string }) {
  return CHANNELS.map((c) => (c === "reddit" ? build(c).title : build(c).text));
}

function allTexts(build: (channel: ShareChannel) => { title: string; text: string }) {
  return CHANNELS.map((c) => build(c)).flatMap((m) => [m.title, m.text]);
}

describe("collectible share URLs", () => {
  it("tags links with utm_campaign=collectible_share per channel", () => {
    const url = new URL(withCollectibleUtm("https://music.example.test/moments/m1?c=c1", "x"));
    expect(url.searchParams.get("c")).toBe("c1");
    expect(url.searchParams.get("utm_source")).toBe("x");
    expect(url.searchParams.get("utm_medium")).toBe("social");
    expect(url.searchParams.get("utm_campaign")).toBe("collectible_share");
    expect(new URL(withCollectibleUtm("https://a.test/x", "copy")).searchParams.get("utm_medium")).toBe("share");
  });

  it("links the moment permalink with the edition-pride view", () => {
    const url = new URL(collectedMomentShareUrl("m 1", "c1", "native"));
    expect(url.pathname).toBe("/moments/m%201");
    expect(url.searchParams.get("c")).toBe("c1");
    expect(url.searchParams.get("utm_campaign")).toBe("collectible_share");
  });

  it("links a drop to its release page focused on moments", () => {
    const url = new URL(dropShareUrl("rel/1", "reddit", "https://music.example.test/"));
    expect(url.origin).toBe("https://music.example.test");
    expect(url.pathname).toBe("/release/rel%2F1");
    expect(url.searchParams.get("focus")).toBe("moments");
    expect(url.searchParams.get("utm_source")).toBe("reddit");
    expect(url.searchParams.get("utm_campaign")).toBe("collectible_share");
  });
});

describe("collectedMomentShareMessage (after_collect)", () => {
  it("names the public edition number", () => {
    const { text } = collectedMomentShareMessage(freeCollect, "native");
    expect(text).toContain("I collected edition №7 of 50 on Resonate.");
    expect(text).toContain('A vocal moment from "Love Will Find You".');
  });

  it("makes the 85% sale claim only for a paid collect", () => {
    for (const text of bodies((c) => collectedMomentShareMessage(paidCollect, c))) {
      expect(text.toLowerCase()).toContain("at least 85%");
    }
    expect(collectedMomentShareMessage(paidCollect, "native").text).toContain(
      `${COLLECT_SALE_CLAIM[0].toUpperCase()}${COLLECT_SALE_CLAIM.slice(1)}.`,
    );
    for (const text of allTexts((c) => collectedMomentShareMessage(freeCollect, c))) {
      expect(text).not.toMatch(/85%|sale|support/i);
    }
  });

  it("says free honestly, and drops the invite when sold out", () => {
    expect(collectedMomentShareMessage(freeCollect, "native").text).toContain(
      "Free to collect while editions last.",
    );
    const soldOut = collectedMomentShareMessage({ ...freeCollect, editionsLeft: 0 }, "native");
    expect(soldOut.text).not.toMatch(/free/i);
  });

  it("describes a held edition as reserved, not delivered", () => {
    const { text } = collectedMomentShareMessage({ ...paidCollect, held: true }, "native");
    expect(text).toContain("Edition №7 of 50 is reserved for me on Resonate.");
    expect(text).not.toContain("I collected");
  });

  it("falls back gracefully without an edition number or artist", () => {
    const { text } = collectedMomentShareMessage(
      { lyricText: "hook", pricePaidCents: 0, artistName: "Unknown Artist" },
      "native",
    );
    expect(text.startsWith("“hook”\n\n")).toBe(true);
    expect(text).toContain("I collected this moment on Resonate.");
  });

  it("masks socially-weighted lyric words on every channel", () => {
    const input = { ...paidCollect, lyricText: "real niggas quote this hook" };
    for (const text of allTexts((c) => collectedMomentShareMessage(input, c))) {
      expect(text).not.toMatch(/nigga/i);
    }
    expect(collectedMomentShareMessage(input, "x").text).toContain("n****s");
  });

  it("keeps X posts within the 280 budget (links as 23) for long inputs", () => {
    const input = {
      ...paidCollect,
      lyricText: long("😀 quotable"),
      artistName: long("Artist"),
      trackTitle: long("Track"),
      editionNumber: 123456,
      editionSize: 999999,
    };
    const { text } = collectedMomentShareMessage(input, "x");
    expect(xPostLength(text)).toBeLessThanOrEqual(X_MAX_LENGTH);
    expect(text).toContain("edition №123456 of 999999");
    const short = collectedMomentShareMessage(paidCollect, "x").text;
    expect(short).toContain("#Resonate");
    expect(short.toLowerCase()).toContain("at least 85%");
    expect(xPostLength(short)).toBeLessThanOrEqual(X_MAX_LENGTH);
  });

  it("keeps Reddit titles within budget", () => {
    const { title } = collectedMomentShareMessage(
      { ...paidCollect, lyricText: long("hook"), artistName: long("Artist") },
      "reddit",
    );
    expect(title.length).toBeLessThanOrEqual(REDDIT_TITLE_MAX_LENGTH);
    expect(title).toContain(COLLECT_SALE_CLAIM);
  });

  it("never uses investment, value, royalty, or income wording", () => {
    for (const input of [freeCollect, paidCollect, { ...paidCollect, held: true }]) {
      for (const text of allTexts((c) => collectedMomentShareMessage(input, c))) {
        expect(text).not.toMatch(YIELD_WORDING);
      }
    }
  });
});

describe("dropPriceSummary", () => {
  it("states free, single price, ranges, mixes, and sold out honestly", () => {
    expect(dropPriceSummary([moment(0), moment(0)]).line).toBe("Free to collect while editions last.");
    expect(dropPriceSummary([moment(200), moment(200)]).line).toBe("$2.00 an edition.");
    expect(dropPriceSummary([moment(150), moment(300)]).line).toBe("Editions from $1.50.");
    expect(dropPriceSummary([moment(0), moment(150)]).line).toBe(
      "Some editions are free to collect; others are $1.50.",
    );
    const soldOut = dropPriceSummary([moment(150, 10)]);
    expect(soldOut).toMatchObject({ soldOut: true, paidAvailable: false });
    expect(soldOut.line).toBe("Every edition has been collected.");
  });

  it("only counts editions still available", () => {
    // The paid moment is sold out, so the drop is free to collect now.
    const summary = dropPriceSummary([moment(500, 10), moment(0, 2)]);
    expect(summary.paidAvailable).toBe(false);
    expect(summary.line).toBe("Free to collect while editions last.");
  });
});

describe("dropShareMessage (drop_page)", () => {
  it("invites people to collect and says free honestly", () => {
    const { title, text } = dropShareMessage(freeDrop, "native");
    expect(title).toBe("A drop from Felicia Farerre on Resonate");
    expect(text).toContain('Collect a limited-edition vocal moment from "Hooks of the Summer" on Resonate.');
    expect(text).toContain("Free to collect while editions last.");
  });

  it("makes the 85% sale claim only while paid editions are on sale", () => {
    expect(dropShareMessage(paidDrop, "native").text).toContain("Editions from $1.50.");
    for (const text of bodies((c) => dropShareMessage(paidDrop, c))) {
      expect(text.toLowerCase()).toContain("at least 85%");
    }
    expect(dropShareMessage(paidDrop, "reddit").title).toContain(DROP_SALE_CLAIM);
    for (const input of [freeDrop, { ...paidDrop, moments: [moment(300, 10)] }]) {
      for (const text of allTexts((c) => dropShareMessage(input, c))) {
        expect(text).not.toMatch(/85%|support/i);
      }
    }
  });

  it("does not invite collecting from a sold-out drop", () => {
    const { text } = dropShareMessage({ ...paidDrop, moments: [moment(300, 10)] }, "native");
    expect(text).not.toMatch(/^Collect/m);
    expect(text).toContain("Every edition has been collected.");
  });

  it("leads a single-moment share with the masked lyric", () => {
    const input = { ...paidDrop, lyricText: "my niggas on the hook", moments: [moment(150)] };
    for (const text of allTexts((c) => dropShareMessage(input, c))) {
      expect(text).not.toMatch(/nigga/i);
    }
    expect(dropShareMessage(input, "native").text.startsWith("“my n****s on the hook” — Felicia Farerre")).toBe(true);
  });

  it("keeps X posts and Reddit titles within budget for long inputs", () => {
    const input: DropShareInput = {
      dropTitle: long("Drop"),
      trackTitle: long("Track"),
      artistName: long("Artist"),
      lyricText: long("😀 lyric"),
      moments: [moment(0), moment(999)],
    };
    const x = dropShareMessage(input, "x").text;
    expect(xPostLength(x)).toBeLessThanOrEqual(X_MAX_LENGTH);
    expect(x).toContain("Some editions are free to collect");
    expect(dropShareMessage(input, "reddit").title.length).toBeLessThanOrEqual(REDDIT_TITLE_MAX_LENGTH);
    const short = dropShareMessage(paidDrop, "x").text;
    expect(short).toContain("#Resonate #Drops");
    expect(xPostLength(short)).toBeLessThanOrEqual(X_MAX_LENGTH);
  });

  it("never uses investment, value, royalty, or income wording", () => {
    for (const input of [freeDrop, paidDrop, { ...paidDrop, moments: [moment(0), moment(100)] }]) {
      for (const text of allTexts((c) => dropShareMessage(input, c))) {
        expect(text).not.toMatch(YIELD_WORDING);
      }
    }
  });
});
