import { describe, expect, it, vi } from "vitest";
import {
  normalizeIncomingNotification,
  getVisibleWalletNotificationSnapshot,
  isWalletNotificationSnapshotCurrent,
  prependWalletNotification,
  registerDisputeNotificationSocketHandlers,
  type DisputeNotification,
  type DisputeStatusUpdate,
} from "./useDisputeNotifications";

type TestHandler = (...args: unknown[]) => void | Promise<void>;

type TestSocket = {
  on: ReturnType<typeof vi.fn>;
  emit: ReturnType<typeof vi.fn>;
};

describe("useDisputeNotifications helpers", () => {
  it("hides wallet notices after an address switch and ignores late events from the prior wallet", () => {
    const firstWalletNotification: DisputeNotification = {
      id: "notif-old",
      type: "dispute_filed",
      title: "Old account notice",
      message: "Private to the previous wallet",
      read: false,
      createdAt: "2026-04-07T10:00:00.000Z",
    };
    const currentWalletNotification: DisputeNotification = {
      id: "notif-current",
      type: "dispute_resolved",
      title: "Current account notice",
      message: "Private to the current wallet",
      read: false,
      createdAt: "2026-04-07T11:00:00.000Z",
    };
    const currentSnapshot = {
      walletAddress: "0xbbb",
      notifications: [currentWalletNotification],
      unreadCount: 1,
    };
    const priorSessionScope = Symbol("prior-session");
    const currentSessionScope = Symbol("current-session");

    expect(getVisibleWalletNotificationSnapshot({
      walletAddress: "0xaaa",
      notifications: [firstWalletNotification],
      unreadCount: 1,
    }, "0xBBB")).toEqual({ notifications: [], unreadCount: 0 });
    expect(getVisibleWalletNotificationSnapshot(currentSnapshot, null)).toEqual({ notifications: [], unreadCount: 0 });
    expect(isWalletNotificationSnapshotCurrent("0xbbb", "0xBBB")).toBe(true);
    expect(prependWalletNotification(currentSnapshot, "0xaaa", firstWalletNotification)).toBe(currentSnapshot);
    expect(getVisibleWalletNotificationSnapshot({
      walletAddress: "0xbbb",
      sessionScope: priorSessionScope,
      notifications: [firstWalletNotification],
      unreadCount: 1,
    }, "0xbbb", currentSessionScope)).toEqual({ notifications: [], unreadCount: 0 });
    expect(prependWalletNotification({ ...currentSnapshot, sessionScope: currentSessionScope }, "0xbbb",
      firstWalletNotification, priorSessionScope)).toMatchObject({ notifications: [currentWalletNotification] });
  });

  it("normalizes realtime notifications using the server timestamp", () => {
    const notification = normalizeIncomingNotification({
      id: "notif-1",
      type: "dispute_filed",
      title: "Content Flagged",
      message: "Flagged",
      disputeId: "d-1",
      releaseId: "rel-1",
      timestamp: "2026-04-07T10:00:00.000Z",
    });

    expect(notification).toEqual<DisputeNotification>({
      id: "notif-1",
      type: "dispute_filed",
      title: "Content Flagged",
      message: "Flagged",
      disputeId: "d-1",
      releaseId: "rel-1",
      read: false,
      createdAt: "2026-04-07T10:00:00.000Z",
    });
  });

  it("joins wallet rooms and refetches notifications on connect", async () => {
    const handlers = new Map<string, TestHandler>();
    const socket: TestSocket = {
      on: vi.fn((event: string, handler: TestHandler) => {
        handlers.set(event, handler);
        return socket;
      }),
      emit: vi.fn(),
    };

    const refetch = vi.fn();
    const onNotification = vi.fn();
    const onDisputeStatus = vi.fn();

    registerDisputeNotificationSocketHandlers(socket as never, {
      walletAddress: "0xAbC",
      refetch,
      onNotification,
      onDisputeStatus,
    });

    await handlers.get("connect")?.();

    expect(socket.emit).toHaveBeenCalledWith("wallet:join", "0xabc");
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it("forwards dispute status updates and normalized notifications", () => {
    const handlers = new Map<string, TestHandler>();
    const socket: TestSocket = {
      on: vi.fn((event: string, handler: TestHandler) => {
        handlers.set(event, handler);
        return socket;
      }),
      emit: vi.fn(),
    };

    const seenNotifications: DisputeNotification[] = [];
    const seenUpdates: DisputeStatusUpdate[] = [];

    registerDisputeNotificationSocketHandlers(socket as never, {
      walletAddress: "0xabc",
      refetch: vi.fn(),
      onNotification: (notification) => { seenNotifications.push(notification); },
      onDisputeStatus: (update) => { seenUpdates.push(update); },
    });

    handlers.get("notification.new")?.({
      id: "notif-2",
      type: "dispute_resolved",
      title: "Resolved",
      message: "Resolved",
      disputeId: "d-2",
      timestamp: "2026-04-07T11:00:00.000Z",
    });

    handlers.get("dispute.status")?.({
      type: "appealed",
      disputeId: "d-2",
      appealNumber: "1",
      timestamp: "2026-04-07T11:01:00.000Z",
    });

    expect(seenNotifications[0]?.createdAt).toBe("2026-04-07T11:00:00.000Z");
    expect(seenUpdates).toEqual([
      {
        type: "appealed",
        disputeId: "d-2",
        appealNumber: "1",
        timestamp: "2026-04-07T11:01:00.000Z",
      },
    ]);
  });
});
