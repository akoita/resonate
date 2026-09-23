import { describe, expect, it, vi } from "vitest";
import {
  MANAGEMENT_INVITATIONS_POLL_INTERVAL_MS,
  registerManagementInvitationRefresh,
  toManagementInvitationItems,
} from "./useManagementInvitations";
import type { PendingManagementInvitations } from "../lib/api";

describe("management invitation notifications", () => {
  it("keeps requested grant scope and transfer resources actionable in the bell", () => {
    const invitations: PendingManagementInvitations = {
      grants: [{
        id: "grant-1",
        artistId: "artist-1",
        releaseId: null,
        resourceName: "Nova",
        scopes: ["CATALOG_READ", "TRACK_AUDIO"],
        expiresAt: "2026-10-01T00:00:00.000Z",
      }],
      transfers: [{
        id: "transfer-1",
        resourceType: "release",
        resources: [{ id: "release-1", name: "First Light" }],
        expiresAt: null,
      }],
    };

    expect(toManagementInvitationItems(invitations)).toEqual([
      {
        id: "management-grant-grant-1",
        kind: "grant",
        title: "Management invitation",
        message: "You were invited to manage Nova. Requested access: view the catalog, replace track audio.",
        expiresAt: "2026-10-01T00:00:00.000Z",
      },
      {
        id: "management-transfer-transfer-1",
        kind: "transfer",
        title: "Management transfer invitation",
        message: "Review the proposed management transfer for First Light.",
        expiresAt: null,
      },
    ]);
  });

  it("refreshes immediately, at a bounded interval, and when the tab becomes visible", async () => {
    vi.useFakeTimers();
    let visibilityState: DocumentVisibilityState = "visible";
    const listeners = new Set<EventListener>();
    const visibilityTarget = {
      get visibilityState() { return visibilityState; },
      addEventListener: (_type: string, listener: EventListener) => listeners.add(listener),
      removeEventListener: (_type: string, listener: EventListener) => listeners.delete(listener),
    } as unknown as Pick<Document, "visibilityState" | "addEventListener" | "removeEventListener">;
    const refetch = vi.fn();

    const cleanup = registerManagementInvitationRefresh(refetch, visibilityTarget);
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(MANAGEMENT_INVITATIONS_POLL_INTERVAL_MS);
    expect(refetch).toHaveBeenCalledTimes(2);

    visibilityState = "hidden";
    await vi.advanceTimersByTimeAsync(MANAGEMENT_INVITATIONS_POLL_INTERVAL_MS);
    expect(refetch).toHaveBeenCalledTimes(2);

    visibilityState = "visible";
    listeners.forEach((listener) => listener(new Event("visibilitychange")));
    await Promise.resolve();
    expect(refetch).toHaveBeenCalledTimes(3);

    cleanup();
    await vi.advanceTimersByTimeAsync(MANAGEMENT_INVITATIONS_POLL_INTERVAL_MS);
    expect(refetch).toHaveBeenCalledTimes(3);
    vi.useRealTimers();
  });
});
