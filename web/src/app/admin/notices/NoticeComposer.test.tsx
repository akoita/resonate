import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SentBroadcastNotice } from "../../../lib/api";
import NoticeComposer, {
  AUDIENCE_OPTIONS,
  BROADCAST_CATEGORIES,
  EMPTY_DRAFT,
  NOTICE_BODY_MAX,
  NOTICE_TITLE_MAX,
  getAudienceReachText,
  getEmailReachText,
  getSendConfirmMessage,
  toBroadcastInput,
  validateNoticeDraft,
  type NoticeDraft,
} from "./NoticeComposer";
import {
  DEFAULT_BANNER_HEADING_ID,
  PlatformNoticeBannerView,
} from "../../../components/notifications/PlatformNoticeBanner";
import PlatformNoticeItems from "../../../components/notifications/PlatformNoticeItems";
import NoticePreview, { PREVIEW_BANNER_HEADING_ID, toPreviewNotice } from "./NoticePreview";
import NoticesView, { type NoticesViewProps } from "./NoticesView";
import SentNoticesList from "./SentNoticesList";

const draft: NoticeDraft = {
  category: "terms",
  audience: "role:artist",
  title: "  New artist terms  ",
  body: "We are updating the artist terms.",
  effectiveDate: "2026-11-01",
};

function render(overrides: Partial<React.ComponentProps<typeof NoticeComposer>> = {}) {
  return renderToStaticMarkup(
    <NoticeComposer
      draft={draft}
      errors={{}}
      sending={false}
      audienceSize={null}
      onChange={() => {}}
      onRequestSend={() => {}}
      {...overrides}
    />,
  );
}

/** The opening tag of the radio with this name and value. */
function radio(html: string, name: string, value: string) {
  const match = html.match(new RegExp(`<input[^>]*name="${name}"[^>]*value="${value}"[^>]*>`));
  expect(match, `radio ${name}=${value}`).not.toBeNull();
  return match![0];
}

function submitButton(html: string) {
  const match = html.match(/<button[^>]*type="submit"[^>]*>/);
  expect(match).not.toBeNull();
  return match![0];
}

const SENT: SentBroadcastNotice = {
  id: "n-1",
  category: "incident",
  title: "Playback outage",
  body: "Resolved.",
  link: null,
  audience: "all",
  effectiveAt: null,
  expiresAt: null,
  active: true,
  createdBy: "op",
  createdAt: "2026-10-15T10:00:00.000Z",
  readCount: 42,
};

describe("admin notice composer (#2146)", () => {
  it("requires a title and a message within the limits", () => {
    expect(validateNoticeDraft(EMPTY_DRAFT)).toEqual({
      title: "Add a title.",
      body: "Add the message people will read.",
    });
    expect(validateNoticeDraft({ ...draft, title: "x".repeat(NOTICE_TITLE_MAX + 1) }).title).toMatch(/120/);
    expect(validateNoticeDraft({ ...draft, body: "x".repeat(NOTICE_BODY_MAX + 1) }).body).toMatch(/2000/);
    expect(validateNoticeDraft({ ...draft, effectiveDate: "not-a-date" }).effectiveDate).toBe("Use a valid date.");
    expect(validateNoticeDraft(draft)).toEqual({});
  });

  it("builds the broadcast the API expects", () => {
    expect(toBroadcastInput(draft)).toEqual({
      category: "terms",
      audience: "role:artist",
      title: "New artist terms",
      body: "We are updating the artist terms.",
      effectiveAt: "2026-11-01T00:00:00.000Z",
    });
    expect(toBroadcastInput({ ...draft, effectiveDate: "" })).not.toHaveProperty("effectiveAt");
  });

  it("asks for confirmation naming the audience and that it cannot be recalled", () => {
    const message = getSendConfirmMessage(draft);
    expect(message).toContain('"New artist terms"');
    expect(message).toContain("artists");
    expect(message).toContain("cannot be edited or recalled");
  });

  it("offers only operator broadcast categories, as a radio group with a description each", () => {
    const html = render();
    expect(BROADCAST_CATEGORIES).toEqual(["policy", "terms", "incident"]);
    for (const category of BROADCAST_CATEGORIES) expect(radio(html, "notice-category", category)).toContain('type="radio"');
    expect(html).not.toContain('value="moderation"');
    expect(html).not.toContain("<select");
    expect(html).toContain("A change to how the platform works or what is allowed.");
    expect(html).toContain("An outage, a security issue, or anything people need to know right now.");
  });

  it("checks the selected category and audience, and only those", () => {
    const html = render();
    expect(radio(html, "notice-category", "terms")).toContain("checked");
    expect(radio(html, "notice-category", "policy")).not.toContain("checked");
    expect(radio(html, "notice-audience", "role:artist")).toContain("checked");
    expect(radio(html, "notice-audience", "all")).not.toContain("checked");
    for (const option of AUDIENCE_OPTIONS) expect(radio(html, "notice-audience", option.value)).toBeTruthy();
    const other = render({ draft: { ...draft, category: "incident", audience: "all" } });
    expect(radio(other, "notice-category", "incident")).toContain("checked");
    expect(radio(other, "notice-audience", "all")).toContain("checked");
  });

  it("reports changes from the radios, the fields and the date", () => {
    const onChange = vi.fn();
    const tree = NoticeComposer({
      draft,
      errors: {},
      sending: false,
      audienceSize: null,
      onChange,
      onRequestSend: () => {},
    });
    const fields: Array<{ name?: string; id?: string; onChange?: (event: unknown) => void; value?: string }> = [];
    const visit = (node: React.ReactNode) => {
      if (Array.isArray(node)) return node.forEach(visit);
      if (!React.isValidElement<Record<string, unknown>>(node)) return;
      if (node.type === "input" || node.type === "textarea") fields.push(node.props as (typeof fields)[number]);
      visit(node.props.children as React.ReactNode);
    };
    visit(tree);
    fields.find((f) => f.name === "notice-category" && f.value === "incident")?.onChange?.({});
    fields.find((f) => f.name === "notice-audience" && f.value === "role:admin")?.onChange?.({});
    fields.find((f) => f.id === "notice-title")?.onChange?.({ target: { value: "Hello" } });
    fields.find((f) => f.id === "notice-body")?.onChange?.({ target: { value: "World" } });
    fields.find((f) => f.id === "notice-effective")?.onChange?.({ target: { value: "2026-12-01" } });
    expect(onChange.mock.calls).toEqual([
      ["category", "incident"],
      ["audience", "role:admin"],
      ["title", "Hello"],
      ["body", "World"],
      ["effectiveDate", "2026-12-01"],
    ]);
  });

  it("shows live character counters against the limits, using the trimmed text", () => {
    const html = render();
    expect(html).toContain(`16/${NOTICE_TITLE_MAX}`);
    expect(html).toContain(`33/${NOTICE_BODY_MAX}`);
    const over = render({ draft: { ...draft, title: "x".repeat(NOTICE_TITLE_MAX + 5) } });
    expect(over).toContain(`${NOTICE_TITLE_MAX + 5}/${NOTICE_TITLE_MAX}`);
    expect(over).toContain('data-over="true"');
    expect(over).toContain("Keep the title to 120 characters.");
    expect(html).not.toContain('data-over="true"');
  });

  it("labels the fields, marks the date optional and warns against personal data", () => {
    const html = render();
    expect(html).toMatch(/<label[^>]*for="notice-title"[^>]*>Title<\/label>/);
    expect(html).toMatch(/<label[^>]*for="notice-body"[^>]*>Message<\/label>/);
    expect(html).toContain("Takes effect");
    expect(html).toContain("(optional)");
    expect(html).toContain('type="date"');
    expect(html).toContain("Do not include personal data.");
  });

  it("disables Review and send until the draft is valid, and says why", () => {
    const empty = render({ draft: EMPTY_DRAFT });
    expect(submitButton(empty)).toContain("disabled");
    expect(empty).toContain("Add a title.");
    const ready = render();
    expect(submitButton(ready)).not.toContain("disabled");
    expect(ready).toContain("Review and send");
    expect(submitButton(render({ draft: { ...draft, body: "  " } }))).toContain("disabled");
    expect(submitButton(render({ draft: { ...draft, effectiveDate: "nope" } }))).toContain("disabled");
  });

  it("shows a busy state and no hint while sending", () => {
    const html = render({ sending: true });
    expect(submitButton(html)).toContain("disabled");
    expect(html).toContain("Sending...");
    expect(html).not.toContain("Review and send");
  });

  it("shows field errors from a send attempt without repeating them under the button", () => {
    const html = render({ draft: EMPTY_DRAFT, errors: { title: "Add a title." } });
    expect(html.match(/Add a title\./g)).toHaveLength(1);
    expect(html).toContain('role="alert"');
    expect(html).toContain('aria-invalid="true"');
  });

  it("has no separate Preview button now that the preview is live", () => {
    expect(render()).not.toMatch(/<button[^>]*>\s*Preview\s*<\/button>/);
  });

  describe("who receives it", () => {
    it("gives the current head count for everyone", () => {
      expect(getAudienceReachText("all", 1234)).toBe(
        "Reaches about 1,234 people today, plus anyone who signs up later.",
      );
      const html = render({ draft: { ...draft, audience: "all" }, audienceSize: 1234 });
      expect(html).toContain("Who receives it");
      expect(html).toContain("about 1,234 people today, plus anyone who signs up later");
    });

    it("omits the number when the overview is unknown", () => {
      const text = getAudienceReachText("all", null);
      expect(text).not.toMatch(/\d/);
      expect(text).toContain("plus anyone who signs up later");
      expect(render({ draft: { ...draft, audience: "all" }, audienceSize: null })).not.toContain("people today");
    });

    it("names a role audience without a number, even when a count is known", () => {
      const text = getAudienceReachText("role:artist", 1234);
      expect(text).toContain("people with an artist profile");
      expect(text).not.toMatch(/\d/);
      expect(getAudienceReachText("role:admin", null)).toContain("platform admins");
    });
  });

  describe("email reach", () => {
    it("says optional categories can be turned off", () => {
      for (const category of ["policy", "incident"] as const) {
        const text = getEmailReachText(category);
        expect(text).toContain("Also emailed to people with a confirmed email address");
        expect(text).toContain("unless they turned this category off");
      }
      expect(render({ draft: { ...draft, category: "policy" } })).toContain("unless they turned this category off");
    });

    it("says required categories cannot be turned off", () => {
      const text = getEmailReachText("terms");
      expect(text).toContain("Also emailed to people with a confirmed email address");
      expect(text).not.toContain("unless they turned this category off");
      expect(text).toContain("nobody can turn them off");
      expect(render({ draft: { ...draft, category: "terms" } })).not.toContain("unless they turned");
    });
  });
});

describe("notice live preview (#2146)", () => {
  it("renders the draft as the banner and as a bell row", () => {
    const html = renderToStaticMarkup(<NoticePreview draft={draft} />);
    expect(html).toContain("Live preview");
    expect(html).toContain("Banner at the top of the app");
    expect(html).toContain("In the notification bell");
    expect(html.match(/New artist terms/g)).toHaveLength(2);
    expect(html.match(/We are updating the artist terms\./g)).toHaveLength(2);
    expect(html.match(/Terms/g)!.length).toBeGreaterThanOrEqual(2);
    expect(html).toContain("Takes effect");
    expect(html).toContain("Shown to artists.");
  });

  it("follows the category and the text as they change", () => {
    const before = renderToStaticMarkup(<NoticePreview draft={draft} />);
    const after = renderToStaticMarkup(
      <NoticePreview draft={{ ...draft, category: "incident", title: "Outage", body: "We are on it.", audience: "all" }} />,
    );
    expect(before).not.toContain("Outage");
    expect(after).toContain("Outage");
    expect(after).toContain("We are on it.");
    expect(after).toContain("Incident");
    expect(after).toContain("rgba(245, 158, 11");
    expect(after).toContain("Shown to everyone.");
  });

  it("shows dimmed placeholders for an empty draft and makes no control reachable", () => {
    const html = renderToStaticMarkup(<NoticePreview draft={EMPTY_DRAFT} />);
    expect(html).toContain("Your title");
    expect(html).toContain("Your message will appear here.");
    expect(html).toContain('data-empty="true"');
    expect(html.match(/inert=""/g)).toHaveLength(2);
  });

  it("renders no action controls and a heading id that cannot clash with the real banner", () => {
    const html = renderToStaticMarkup(<NoticePreview draft={draft} />);
    expect(html).not.toContain("Dismiss");
    expect(html).not.toContain("Mark as read");
    expect(html).not.toContain("<button");
    expect(PREVIEW_BANNER_HEADING_ID).not.toBe(DEFAULT_BANNER_HEADING_ID);
    expect(html).toContain(`id="${PREVIEW_BANNER_HEADING_ID}"`);
    expect(html).toContain(`aria-labelledby="${PREVIEW_BANNER_HEADING_ID}"`);
    expect(html).not.toContain(DEFAULT_BANNER_HEADING_ID);
    // The same views keep their controls and id for everyone else.
    const real = renderToStaticMarkup(
      <PlatformNoticeBannerView notice={toPreviewNotice(draft)} dismissing={false} onDismiss={() => {}} />,
    );
    expect(real).toContain("Dismiss");
    expect(real).toContain(`id="${DEFAULT_BANNER_HEADING_ID}"`);
    const bell = renderToStaticMarkup(<PlatformNoticeItems notices={[toPreviewNotice(draft)]} onSelect={() => {}} />);
    expect(bell).toContain("Mark as read");
    expect(bell).toContain("<button");
    expect(toPreviewNotice({ ...EMPTY_DRAFT, title: "  Hi  " }).title).toBe("Hi");
    expect(toPreviewNotice(draft).effectiveAt).toBe("2026-11-01T00:00:00.000Z");
  });
});

describe("sent broadcasts (#2146)", () => {
  it("lists a broadcast with its chips, date and read count", () => {
    const html = renderToStaticMarkup(
      <SentNoticesList onRetry={() => {}} audienceSize={null} state={{ status: "ready", notices: [SENT] }} />,
    );
    expect(html).toContain("Playback outage");
    expect(html).toContain("Resolved.");
    expect(html).toContain("Incident");
    expect(html).toContain("Everyone");
    expect(html).toContain('dateTime="2026-10-15T10:00:00.000Z"');
    expect(html).toContain("Sent 15 Oct 2026");
    expect(html).toContain("Read by 42");
    expect(html).not.toContain("admin-notices-bar");
    expect(html).not.toContain("Expired");
  });

  it("draws a read-rate bar for everyone broadcasts when the head count is known", () => {
    const html = renderToStaticMarkup(
      <SentNoticesList onRetry={() => {}} audienceSize={200} state={{ status: "ready", notices: [SENT] }} />,
    );
    expect(html).toContain("Read by 42 of about 200 people today (21%)");
    expect(html).toContain("width:21%");
    const over = renderToStaticMarkup(
      <SentNoticesList onRetry={() => {}} audienceSize={10} state={{ status: "ready", notices: [SENT] }} />,
    );
    expect(over).toContain("width:100%");
  });

  it("shows only a count for a role audience, plus effective, expiry and expired state", () => {
    const html = renderToStaticMarkup(
      <SentNoticesList
        onRetry={() => {}}
        audienceSize={200}
        state={{
          status: "ready",
          notices: [
            {
              ...SENT,
              category: "terms",
              audience: "role:artist",
              effectiveAt: "2026-11-01T00:00:00.000Z",
              expiresAt: "2026-12-01T00:00:00.000Z",
              active: false,
            },
          ],
        }}
      />,
    );
    expect(html).toContain("Terms");
    expect(html).toContain("Artists");
    expect(html).toMatch(/Takes effect .*2026/);
    expect(html).toContain("Expires 1 Dec 2026");
    expect(html).toContain("Expired");
    expect(html).toContain("Read by 42");
    expect(html).not.toContain("admin-notices-bar");
  });

  it("has an empty state that points at the first broadcast", () => {
    const html = renderToStaticMarkup(
      <SentNoticesList onRetry={() => {}} audienceSize={null} state={{ status: "ready", notices: [] }} />,
    );
    expect(html).toContain("No broadcasts yet");
    expect(html).toContain("Your first one appears here");
  });

  it("has loading and retryable error states", () => {
    const loading = renderToStaticMarkup(
      <SentNoticesList onRetry={() => {}} audienceSize={null} state={{ status: "loading" }} />,
    );
    expect(loading).toContain("Loading sent broadcasts");
    const error = renderToStaticMarkup(
      <SentNoticesList onRetry={() => {}} audienceSize={null} state={{ status: "error" }} />,
    );
    expect(error).toContain("Could not load sent broadcasts");
    expect(error).toContain("Retry");
  });
});

describe("notices page view (#2146)", () => {
  function props(overrides: Partial<NoticesViewProps> = {}): NoticesViewProps {
    return {
      canSend: true,
      draft,
      errors: {},
      sending: false,
      audienceSize: 500,
      sent: { status: "ready", notices: [SENT] },
      onChange: () => {},
      onRequestSend: () => {},
      onRetrySent: () => {},
      ...overrides,
    };
  }

  it("shows the header, the composer, the live preview and the sent list", () => {
    const html = renderToStaticMarkup(<NoticesView {...props()} />);
    expect(html).toContain("Operator");
    expect(html).toContain("Platform notices");
    expect(html).toContain("Compose a broadcast");
    expect(html).toContain("Live preview");
    expect(html).toContain("Sent broadcasts");
    expect(html).toContain("Playback outage");
  });

  it("keeps the role gate: others only see why they cannot send", () => {
    const html = renderToStaticMarkup(<NoticesView {...props({ canSend: false })} />);
    expect(html).toContain("Only operators and admins can send platform notices.");
    expect(html).not.toContain("Compose a broadcast");
    expect(html).not.toContain("Sent broadcasts");
  });
});
