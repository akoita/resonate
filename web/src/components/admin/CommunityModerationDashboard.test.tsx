import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import CommunityModerationDashboard from "./CommunityModerationDashboard";
import type { CommunityModerationQueueResponse } from "../../lib/api";

describe("CommunityModerationDashboard", () => {
  it("renders restricted admin state", () => {
    const html = renderToStaticMarkup(<CommunityModerationDashboard status="forbidden" />);

    expect(html).toContain("Community moderation is restricted");
    expect(html).toContain("admin account");
  });

  it("renders an empty moderation queue", () => {
    const html = renderToStaticMarkup(
      <CommunityModerationDashboard
        status="ready"
        queue={{ ...queue, reports: [], summary: { ...queue.summary, returnedReports: 0, openReports: 0 } }}
        resolvingReportId={null}
        onRefresh={() => {}}
        onResolve={() => {}}
      />,
    );

    expect(html).toContain("The moderation queue is clear.");
    expect(html).toContain("Wallets redacted");
  });

  it("renders report context and available moderation actions without private metadata", () => {
    const html = renderToStaticMarkup(
      <CommunityModerationDashboard
        status="ready"
        queue={queue}
        resolvingReportId={null}
        onRefresh={() => {}}
        onResolve={() => {}}
      />,
    );

    expect(html).toContain("Moderation Queue");
    expect(html).toContain("Ada Mix Holder Room");
    expect(html).toContain("Safety review requested");
    expect(html).toContain("Ban Member");
    expect(html).toContain("Pause Room");
    expect(html).toContain("No emails or wallets");
    expect(html).not.toContain("@test.resonate");
    expect(html).not.toContain("0x1111111111111111111111111111111111111111");
  });
});

const queue: CommunityModerationQueueResponse = {
  schemaVersion: "community-moderation-queue/v1",
  generatedAt: "2026-06-04T08:00:00.000Z",
  filters: { status: "open", limit: 50 },
  summary: {
    returnedReports: 1,
    openReports: 1,
    pausedRooms: 0,
    archivedRooms: 0,
  },
  reports: [
    {
      id: "report-1",
      status: "open",
      reason: "Safety review requested",
      reporterUserId: "listener-reporter",
      createdAt: "2026-06-04T07:55:00.000Z",
      resolvedAt: null,
      room: {
        id: "room-1",
        roomType: "artist_holder",
        ownerType: "artist",
        ownerId: "artist-1",
        artistId: "artist-1",
        title: "Ada Mix Holder Room",
        status: "active",
        createdAt: "2026-06-04T07:00:00.000Z",
        updatedAt: "2026-06-04T07:00:00.000Z",
      },
      message: {
        id: "message-1",
        roomId: "room-1",
        authorUserId: "listener-author",
        bodyPreview: "This needs a moderator.",
        messageType: "message",
        status: "visible",
        createdAt: "2026-06-04T07:45:00.000Z",
        updatedAt: "2026-06-04T07:45:00.000Z",
        deletedAt: null,
      },
      context: {
        roomOpenReports: 1,
        messageReportCount: 1,
        roomMembershipsByStatus: { active: 8, banned: 1 },
      },
    },
  ],
  actions: ["no_action", "delete_message", "remove_member", "ban_member", "pause_room", "archive_room"],
  privacy: {
    operatorOnly: true,
    noWalletAddresses: true,
    noUserEmails: true,
    noAccessPolicyPayloads: true,
    messageBodiesArePreviewed: true,
    actionNotesStored: false,
  },
};
