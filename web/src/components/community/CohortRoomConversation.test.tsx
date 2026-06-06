import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CommunityMessage } from "../../lib/api";
import {
  CohortRoomConversationView,
  cohortMessageAuthorLabel,
  cohortMessageRemoved,
  isOwnCohortMessage,
} from "./CohortRoomConversation";

function message(overrides: Partial<CommunityMessage> = {}): CommunityMessage {
  return {
    id: "message-1",
    roomId: "room-1",
    authorId: "me",
    authorLabel: "You",
    body: "Hello cohort",
    messageType: "message",
    status: "visible",
    createdAt: "2026-06-04T08:00:00.000Z",
    updatedAt: "2026-06-04T08:00:00.000Z",
    deletedAt: null,
    ...overrides,
  };
}

const otherMessage = message({
  id: "message-2",
  authorId: null,
  authorLabel: "Cohort member",
  body: "A peer message",
});

function viewProps(overrides: Partial<React.ComponentProps<typeof CohortRoomConversationView>> = {}) {
  return {
    messages: [] as CommunityMessage[],
    currentUserId: "me" as string | null,
    loading: false,
    error: null as string | null,
    roomActive: true,
    emptyTitle: "Cohort room is ready",
    emptyDescription: "Start the conversation with this cohort.",
    draft: "",
    busyKey: null as string | null,
    notice: null,
    reportingMessageId: null as string | null,
    reportReason: "Concern for moderator review",
    onDraftChange: vi.fn(),
    onPost: vi.fn(),
    onRetry: vi.fn(),
    onStartReport: vi.fn(),
    onCancelReport: vi.fn(),
    onReportReasonChange: vi.fn(),
    onSubmitReport: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
}

describe("CohortRoomConversation helpers", () => {
  it("labels own and redacted authors without exposing ids", () => {
    expect(cohortMessageAuthorLabel(message(), "me")).toBe("You");
    expect(cohortMessageAuthorLabel(otherMessage, "me")).toBe("Cohort member");
    // Fallback when the server did not provide a label.
    expect(cohortMessageAuthorLabel(message({ authorLabel: null }), "me")).toBe("You");
    expect(cohortMessageAuthorLabel(message({ authorId: "someone", authorLabel: null }), "me")).toBe("Cohort member");
  });

  it("detects own messages and removed messages", () => {
    expect(isOwnCohortMessage(message(), "me")).toBe(true);
    expect(isOwnCohortMessage(otherMessage, "me")).toBe(false);
    expect(isOwnCohortMessage(message({ authorId: null }), null)).toBe(false);
    expect(cohortMessageRemoved(message({ status: "deleted_by_author", body: null }))).toBe(true);
    expect(cohortMessageRemoved(message())).toBe(false);
  });
});

describe("CohortRoomConversationView", () => {
  it("renders the loading state", () => {
    const html = renderToStaticMarkup(<CohortRoomConversationView {...viewProps({ loading: true })} />);
    expect(html).toContain("Loading conversation...");
    expect(html).not.toContain("Post message");
  });

  it("renders the error state with retry", () => {
    const html = renderToStaticMarkup(
      <CohortRoomConversationView {...viewProps({ error: "Room unavailable" })} />,
    );
    expect(html).toContain("Conversation unavailable");
    expect(html).toContain("Room unavailable");
    expect(html).toContain("Retry");
  });

  it("renders the empty state and a composer while the room is active", () => {
    const html = renderToStaticMarkup(<CohortRoomConversationView {...viewProps()} />);
    expect(html).toContain("Cohort room is ready");
    expect(html).toContain("Start the conversation with this cohort.");
    expect(html).toContain("Post message");
  });

  it("shows delete only on own messages and report only on peers, with redacted labels", () => {
    const html = renderToStaticMarkup(
      <CohortRoomConversationView {...viewProps({ messages: [message(), otherMessage] })} />,
    );
    expect(html).toContain("You");
    expect(html).toContain("Cohort member");
    expect(html).toContain("Hello cohort");
    expect(html).toContain("A peer message");
    expect(html).toContain(">Delete</button>");
    expect(html).toContain(">Report</button>");
    // No raw peer identifier is ever rendered.
    expect(html).not.toContain("authorId");
  });

  it("renders removed messages without actions", () => {
    const html = renderToStaticMarkup(
      <CohortRoomConversationView
        {...viewProps({ messages: [message({ status: "deleted_by_moderator", body: null })] })}
      />,
    );
    expect(html).toContain("Message removed.");
    expect(html).not.toContain(">Delete</button>");
    expect(html).not.toContain(">Report</button>");
  });

  it("hides the composer and shows a read-only banner when the room is paused/archived", () => {
    const html = renderToStaticMarkup(
      <CohortRoomConversationView {...viewProps({ roomActive: false, messages: [otherMessage] })} />,
    );
    expect(html).toContain("Room is read-only");
    expect(html).not.toContain("Post message");
  });
});
