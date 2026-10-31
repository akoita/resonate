import { describe, expect, it } from "vitest";
import {
  CAMPAIGN_REFUND_LINE,
  CAMPAIGN_SHARE_UTM_CAMPAIGN,
  campaignShareAnalytics,
  campaignShareMessage,
  campaignShareState,
  campaignShareUrl,
  type CampaignShareTrigger,
  type ShareableCampaign,
} from "./campaignShare";
import { REDDIT_TITLE_MAX_LENGTH, X_MAX_LENGTH, xPostLength, type ShareChannel } from "./listeningShare";

const ORIGIN = "https://music.example.test";
const NOW = Date.parse("2026-10-01T12:00:00Z");
const DAY = 24 * 60 * 60 * 1000;

const open: ShareableCampaign = {
  id: "nadia-okoro-paris",
  backendId: "cmp_123",
  title: "Nadia Okoro in Paris",
  artistName: "Nadia Okoro",
  city: "Paris",
  rawStatus: "active",
  campaignLevel: "active_escrow_campaign",
  artistAuthorityStatus: "artist_authorized",
  beneficiaryAddress: "0x1111111111111111111111111111111111111111",
  beneficiaryType: "artist",
  contractAddress: "0x2222222222222222222222222222222222222222",
  contractCampaignId: "7",
  deadline: new Date(NOW + 12 * DAY).toISOString(),
  goalCents: 1_000_000,
  raisedCents: 420_000,
};

const signal: ShareableCampaign = { ...open, campaignLevel: "signal", rawStatus: "draft", contractAddress: null };
const funded: ShareableCampaign = { ...open, rawStatus: "funded", raisedCents: 1_000_000 };
const booked: ShareableCampaign = { ...funded, rawStatus: "booking_confirmed" };
const CLOSED_STATUSES = ["cancelled", "failed", "refund_available", "refunded", "released"];

const CHANNELS: ShareChannel[] = ["x", "facebook", "reddit", "native", "copy"];
const TRIGGERS: CampaignShareTrigger[] = ["page", "after_signal", "after_pledge"];
const allCopy = (campaign: ShareableCampaign, trigger: CampaignShareTrigger, nowMs = NOW) =>
  CHANNELS.map((channel) => {
    const message = campaignShareMessage(campaign, channel, { trigger, nowMs });
    return `${message.title}\n${message.text}`;
  }).join("\n");

describe("campaignShareUrl", () => {
  it("links the public campaign page with per-channel UTM attribution", () => {
    expect(campaignShareUrl(`${ORIGIN}/`, open, "x")).toBe(
      `${ORIGIN}/shows/nadia-okoro-paris?utm_source=x&utm_medium=social&utm_campaign=${CAMPAIGN_SHARE_UTM_CAMPAIGN}`,
    );
    expect(campaignShareUrl(ORIGIN, open, "reddit")).toContain("utm_source=reddit&utm_medium=social");
    expect(campaignShareUrl(ORIGIN, open, "copy")).toContain("utm_source=copy&utm_medium=share");
    expect(campaignShareUrl(ORIGIN, open, "native")).toContain("utm_source=native&utm_medium=share");
    expect(campaignShareUrl(ORIGIN, { id: "a/b" }, "copy")).toMatch(/\/shows\/a%2Fb\?/);
  });
});

describe("campaignShareState", () => {
  it("classifies open, pre-pledge, funded and closed campaigns", () => {
    expect(campaignShareState(open, NOW)).toBe("open");
    expect(campaignShareState(signal, NOW)).toBe("pre_pledge");
    expect(campaignShareState({ ...open, artistAuthorityStatus: "pending" }, NOW)).toBe("pre_pledge");
    expect(campaignShareState(funded, NOW)).toBe("funded");
    expect(campaignShareState(booked, NOW)).toBe("funded");
    for (const rawStatus of CLOSED_STATUSES) {
      expect(campaignShareState({ ...open, rawStatus }, NOW)).toBe("closed");
    }
    expect(campaignShareState({ ...open, deadline: new Date(NOW - DAY).toISOString() }, NOW)).toBe("closed");
  });
});

describe("campaignShareMessage", () => {
  it("invites fans to back an open campaign from the page, with the refund promise", () => {
    const { text } = campaignShareMessage(open, "native", { trigger: "page", nowMs: NOW });
    expect(text).toBe(
      `I want Nadia Okoro in Paris. Back "Nadia Okoro in Paris" on Resonate: 42% funded, 12 days left. ${CAMPAIGN_REFUND_LINE}`,
    );
  });

  it("states the pledge after a pledge, always with the automatic refund", () => {
    const { text } = campaignShareMessage(open, "x", { trigger: "after_pledge", nowMs: NOW });
    expect(text).toBe(`I backed "Nadia Okoro in Paris" on Resonate: 42% funded, 12 days left. ${CAMPAIGN_REFUND_LINE}`);
    const fundedText = campaignShareMessage(funded, "x", { trigger: "after_pledge", nowMs: NOW }).text;
    expect(fundedText).toContain("reached its funding goal");
    expect(fundedText).toContain(CAMPAIGN_REFUND_LINE);
  });

  it("asks for more signals after a demand signal", () => {
    for (const campaign of [open, signal]) {
      expect(campaignShareMessage(campaign, "x", { trigger: "after_signal", nowMs: NOW }).text).toBe(
        `I want Nadia Okoro in Paris. Add your signal to "Nadia Okoro in Paris" on Resonate.`,
      );
    }
  });

  it("never invites backing a campaign that is not open for pledges", () => {
    for (const trigger of TRIGGERS) {
      expect(allCopy(signal, trigger)).not.toMatch(/\bback\b/i);
      expect(allCopy(booked, trigger)).not.toMatch(/\bback\b|\bbacked\b/i);
    }
  });

  it("gives terminal and refund states neutral copy with no call to back it", () => {
    for (const rawStatus of CLOSED_STATUSES) {
      for (const trigger of TRIGGERS) {
        const copy = allCopy({ ...open, rawStatus }, trigger);
        expect(copy).not.toMatch(/\bback(ed)?\b|add your signal|funded,|days left/i);
        expect(copy).toContain("Fans rallied for Nadia Okoro in Paris");
      }
    }
  });

  it("states the pledge only alongside the refund line", () => {
    for (const campaign of [open, signal, funded, booked]) {
      for (const trigger of TRIGGERS) {
        for (const channel of ["x", "native", "copy"] as ShareChannel[]) {
          const { text } = campaignShareMessage(campaign, channel, { trigger, nowMs: NOW });
          if (/I backed/.test(text)) expect(text).toContain(CAMPAIGN_REFUND_LINE);
        }
      }
    }
  });

  it("never implies a guaranteed show or ticket", () => {
    for (const campaign of [open, signal, funded, booked]) {
      for (const trigger of TRIGGERS) {
        expect(allCopy(campaign, trigger)).not.toMatch(/guarantee|ticket|will happen|is happening|confirmed/i);
      }
    }
  });

  it("never carries private pledge data, even when the caller passes a full campaign and pledge", () => {
    const leaky = {
      ...open,
      tiers: [{ id: "patron-circle", title: "Patron circle", amountCents: 25_000, currency: "EUR" }],
      walletAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
      pledge: { amountUnits: "250000000", receiptId: "rcpt_999", tierId: "patron-circle" },
    } as unknown as ShareableCampaign;
    for (const trigger of TRIGGERS) {
      const copy = allCopy(leaky, trigger);
      expect(copy).not.toMatch(/0x[0-9a-f]{6,}/i);
      expect(copy).not.toMatch(/[€$]|\bEUR\b|\bUSDC?\b|250|Patron|rcpt_|receipt|tier/i);
    }
  });

  it("leaves out time-dependent numbers before mount", () => {
    const { text } = campaignShareMessage(open, "native", { trigger: "page" });
    expect(text).toContain("42% funded.");
    expect(text).not.toMatch(/days left/);
  });

  it("stays within the X budget for long names, keeping the refund line", () => {
    const long = (seed: string) => `${seed} `.repeat(40).slice(0, 200).trim();
    const huge = { ...open, title: long("Midnight"), artistName: long("Orchestra"), city: long("Saint") };
    for (const campaign of [open, signal, funded, huge, { ...huge, rawStatus: "refunded" }]) {
      for (const trigger of TRIGGERS) {
        const { text } = campaignShareMessage(campaign, "x", { trigger, nowMs: NOW });
        expect(xPostLength(text)).toBeLessThanOrEqual(X_MAX_LENGTH);
        if (trigger !== "after_signal" && campaignShareState(campaign, NOW) === "open") {
          expect(text).toContain(CAMPAIGN_REFUND_LINE);
        }
      }
    }
  });

  it("counts a link in the text as 23 characters", () => {
    const url = `https://example.test/${"x".repeat(200)}`;
    expect(xPostLength(url)).toBe(23 + 1 + 23);
  });

  it("keeps the Reddit title within its limit", () => {
    const huge = { ...open, title: "T".repeat(400), artistName: "A".repeat(300) };
    const { title, text } = campaignShareMessage(huge, "reddit", { trigger: "page", nowMs: NOW });
    expect(title.length).toBeLessThanOrEqual(REDDIT_TITLE_MAX_LENGTH);
    expect(text).toBe("");
    expect(campaignShareMessage(open, "reddit", { trigger: "page" }).title).toBe(
      `Nadia Okoro in Paris: "Nadia Okoro in Paris", a show campaign on Resonate`,
    );
  });
});

describe("campaignShareAnalytics", () => {
  it("carries the campaign id, channel and trigger only", () => {
    const leaky = { ...open, walletAddress: "0xabc", raisedCents: 5 } as ShareableCampaign;
    expect(campaignShareAnalytics(leaky, "x", "after_pledge")).toEqual({
      source: "shows_campaign_page",
      subjectType: "show_campaign",
      subjectId: "cmp_123",
      payload: { campaignId: "cmp_123", channel: "x", trigger: "after_pledge" },
    });
  });
});
