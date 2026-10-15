import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import NoticeComposer, {
  EMPTY_DRAFT,
  NOTICE_BODY_MAX,
  NOTICE_TITLE_MAX,
  SentNoticesList,
  getSendConfirmMessage,
  toBroadcastInput,
  validateNoticeDraft,
  type NoticeDraft,
} from "./NoticeComposer";

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
      showPreview={false}
      sending={false}
      onChange={() => {}}
      onPreview={() => {}}
      onRequestSend={() => {}}
      {...overrides}
    />,
  );
}

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

  it("offers only operator broadcast categories and every audience", () => {
    const html = render();
    expect(html).toContain('value="policy"');
    expect(html).toContain('value="terms"');
    expect(html).toContain('value="incident"');
    expect(html).not.toContain('value="moderation"');
    expect(html).toContain('value="role:artist"');
    expect(html).toContain("Review and send");
  });

  it("shows field errors and a preview of the banner people will see", () => {
    const html = render({ errors: { title: "Add a title." }, showPreview: true });
    expect(html).toContain("Add a title.");
    expect(html).toContain('aria-label="Preview"');
    expect(html).toContain("New artist terms");
    expect(html).toContain("Artists (people with an artist profile)");
    expect(html).toContain("Takes effect");
  });

  it("asks for confirmation naming the audience and that it cannot be recalled", () => {
    const message = getSendConfirmMessage(draft);
    expect(message).toContain('"New artist terms"');
    expect(message).toContain("artists");
    expect(message).toContain("cannot be edited or recalled");
  });

  it("lists sent broadcasts with their audience and read count", () => {
    const html = renderToStaticMarkup(
      <SentNoticesList
        onRetry={() => {}}
        state={{
          status: "ready",
          notices: [
            {
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
            },
          ],
        }}
      />,
    );
    expect(html).toContain("Playback outage");
    expect(html).toContain("Everyone");
    expect(html).toContain("read by 42");
  });
});
