import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CommunityMessage } from "../../lib/api";
import {
  CommunityMessageItem,
  communityMessageRemoved,
  formatCommunityMessageTime,
} from "./CommunityMessageItem";

function message(overrides: Partial<CommunityMessage> = {}): CommunityMessage {
  return {
    id: "message-1",
    roomId: "room-1",
    authorId: "author-1",
    authorLabel: "A supporter",
    body: "Hello room",
    messageType: "message",
    status: "visible",
    createdAt: "2026-06-04T08:00:00.000Z",
    updatedAt: "2026-06-04T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

describe("communityMessageRemoved", () => {
  it("treats non-visible or body-less messages as removed", () => {
    expect(communityMessageRemoved(message())).toBe(false);
    expect(communityMessageRemoved(message({ status: "deleted_by_moderator", body: null }))).toBe(true);
    expect(communityMessageRemoved(message({ body: null }))).toBe(true);
  });
});

describe("formatCommunityMessageTime", () => {
  it("returns the raw value when the date cannot be parsed", () => {
    expect(formatCommunityMessageTime("not-a-date")).toBe("not-a-date");
  });
});

describe("CommunityMessageItem", () => {
  it("renders moderation actions only when the viewer can moderate", () => {
    const html = renderToStaticMarkup(
      <CommunityMessageItem
        message={message()}
        author="A supporter"
        removed={false}
        canReport
        canDelete
        canRemoveMember
        canBan
      />,
    );
    expect(html).toContain("A supporter");
    expect(html).toContain(">Report</button>");
    expect(html).toContain(">Delete</button>");
    expect(html).toContain(">Remove member</button>");
    expect(html).toContain(">Ban</button>");
  });

  it("applies the announcement treatment", () => {
    const html = renderToStaticMarkup(
      <CommunityMessageItem
        message={message({ messageType: "announcement" })}
        author="Artist announcement"
        removed={false}
        announcement
      />,
    );
    expect(html).toContain("artist-community-message--announcement");
    expect(html).toContain("Artist announcement");
  });

  it("hides body and all actions for removed messages", () => {
    const html = renderToStaticMarkup(
      <CommunityMessageItem
        message={message({ status: "deleted_by_moderator", body: null })}
        author="A supporter"
        removed
        canReport
        canDelete
      />,
    );
    expect(html).toContain("Message removed.");
    expect(html).not.toContain(">Report</button>");
    expect(html).not.toContain(">Delete</button>");
  });

  it("shows the inline report form while reporting", () => {
    const html = renderToStaticMarkup(
      <CommunityMessageItem
        message={message()}
        author="A supporter"
        removed={false}
        canReport
        reporting
        reportReason="Spam"
        onCancelReport={() => undefined}
      />,
    );
    expect(html).toContain("artist-community-report");
    expect(html).toContain(">Send report</button>");
    expect(html).toContain(">Cancel</button>");
  });
});
