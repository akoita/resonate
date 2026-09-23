"use client";

import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface DisputeNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  disputeId?: string;
  releaseId?: string;
  stemListingId?: string;
  read: boolean;
  createdAt: string;
}

export interface DisputeStatusUpdate {
  type: "filed" | "resolved" | "appealed";
  disputeId: string;
  tokenId?: string;
  outcome?: string;
  reporterAddress?: string;
  appealerAddress?: string;
  appealNumber?: string;
  timestamp: string;
}

export interface IncomingNotificationEvent {
  id: string;
  type: string;
  title: string;
  message: string;
  disputeId?: string;
  releaseId?: string;
  stemListingId?: string;
  timestamp?: string;
}

export type WalletNotificationSnapshot = {
  walletAddress: string | null;
  sessionScope?: symbol | null;
  notifications: DisputeNotification[];
  unreadCount: number;
};

export function isWalletNotificationSnapshotCurrent(
  snapshotWalletAddress: string | null,
  currentWalletAddress?: string | null,
) {
  const normalizedAddress = currentWalletAddress?.toLowerCase() ?? null;
  return normalizedAddress !== null && snapshotWalletAddress === normalizedAddress;
}

export function getVisibleWalletNotificationSnapshot(
  snapshot: WalletNotificationSnapshot,
  currentWalletAddress?: string | null,
  currentSessionScope?: symbol | null,
): Pick<WalletNotificationSnapshot, "notifications" | "unreadCount"> {
  if (isWalletNotificationSnapshotCurrent(snapshot.walletAddress, currentWalletAddress)
    && (currentSessionScope === undefined || snapshot.sessionScope === currentSessionScope)) {
    return { notifications: snapshot.notifications, unreadCount: snapshot.unreadCount };
  }
  return { notifications: [], unreadCount: 0 };
}

export function prependWalletNotification(
  snapshot: WalletNotificationSnapshot,
  sourceWalletAddress: string,
  notification: DisputeNotification,
  sourceSessionScope?: symbol | null,
): WalletNotificationSnapshot {
  if (!isWalletNotificationSnapshotCurrent(snapshot.walletAddress, sourceWalletAddress)
    || (sourceSessionScope !== undefined && snapshot.sessionScope !== sourceSessionScope)) return snapshot;
  return {
    ...snapshot,
    notifications: [notification, ...snapshot.notifications],
    unreadCount: snapshot.unreadCount + 1,
  };
}

export function normalizeIncomingNotification(data: IncomingNotificationEvent): DisputeNotification {
  return {
    id: data.id,
    type: data.type,
    title: data.title,
    message: data.message,
    disputeId: data.disputeId,
    releaseId: data.releaseId,
    stemListingId: data.stemListingId,
    read: false,
    createdAt: data.timestamp || new Date().toISOString(),
  };
}

export function registerDisputeNotificationSocketHandlers(
  socket: Pick<Socket, "on" | "emit">,
  options: {
    walletAddress: string;
    refetch: () => void | Promise<void>;
    onNotification: (notification: DisputeNotification) => void;
    onDisputeStatus: (update: DisputeStatusUpdate) => void;
  },
) {
  const normalizedWallet = options.walletAddress.toLowerCase();

  socket.on("connect", () => {
    socket.emit("wallet:join", normalizedWallet);
    void options.refetch();
  });

  socket.on("notification.new", (data: IncomingNotificationEvent) => {
    options.onNotification(normalizeIncomingNotification(data));
  });

  socket.on("dispute.status", (data: DisputeStatusUpdate) => {
    options.onDisputeStatus(data);
  });
}

export function useDisputeNotifications(walletAddress?: string) {
  const normalizedWalletAddress = walletAddress?.toLowerCase() ?? null;
  const sessionScope = useMemo(
    () => normalizedWalletAddress ? Symbol("wallet-notification-session") : null,
    [normalizedWalletAddress],
  );
  const [snapshot, setSnapshot] = useState<WalletNotificationSnapshot>({
    walletAddress: null,
    sessionScope: null,
    notifications: [],
    unreadCount: 0,
  });
  const [disputeUpdateSnapshot, setDisputeUpdateSnapshot] = useState<{
    walletAddress: string | null;
    sessionScope: symbol | null;
    update: DisputeStatusUpdate | null;
  }>({ walletAddress: null, sessionScope: null, update: null });
  const socketRef = useRef<Socket | null>(null);
  const activeWalletAddressRef = useRef<string | null>(normalizedWalletAddress);
  const activeSessionScopeRef = useRef<symbol | null>(sessionScope);
  const fetchSequenceRef = useRef(0);
  const visibleSnapshot = getVisibleWalletNotificationSnapshot(snapshot, normalizedWalletAddress, sessionScope);
  const disputeUpdate = isWalletNotificationSnapshotCurrent(
    disputeUpdateSnapshot.walletAddress,
    normalizedWalletAddress,
  ) && disputeUpdateSnapshot.sessionScope === sessionScope ? disputeUpdateSnapshot.update : null;

  // Fetch notifications from REST API
  const fetchNotifications = useCallback(async () => {
    const requestedWalletAddress = normalizedWalletAddress;
    if (!requestedWalletAddress || !sessionScope
      || activeWalletAddressRef.current !== requestedWalletAddress
      || activeSessionScopeRef.current !== sessionScope) return;
    const requestSequence = ++fetchSequenceRef.current;
    try {
      const res = await fetch(`/api/metadata/notifications/${requestedWalletAddress}`);
      if (res.ok && requestSequence === fetchSequenceRef.current
        && activeWalletAddressRef.current === requestedWalletAddress
        && activeSessionScopeRef.current === sessionScope) {
        const data = await res.json();
        if (requestSequence === fetchSequenceRef.current
          && activeWalletAddressRef.current === requestedWalletAddress
          && activeSessionScopeRef.current === sessionScope) {
          setSnapshot({
            walletAddress: requestedWalletAddress,
            sessionScope,
            notifications: data.notifications || [],
            unreadCount: data.unreadCount || 0,
          });
        }
      }
    } catch {
      // silent
    }
  }, [activeSessionScopeRef, activeWalletAddressRef, normalizedWalletAddress, sessionScope, setSnapshot]);

  // Mark single notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    const requestedWalletAddress = normalizedWalletAddress;
    if (!requestedWalletAddress || !sessionScope
      || activeWalletAddressRef.current !== requestedWalletAddress
      || activeSessionScopeRef.current !== sessionScope) return;
    try {
      await fetch(`/api/metadata/notifications/${notificationId}/read`, { method: "PATCH" });
      if (activeWalletAddressRef.current !== requestedWalletAddress
        || activeSessionScopeRef.current !== sessionScope) return;
      setSnapshot((prev) => {
        if (!isWalletNotificationSnapshotCurrent(prev.walletAddress, requestedWalletAddress)
          || prev.sessionScope !== sessionScope) return prev;
        const wasUnread = prev.notifications.some((notification) => notification.id === notificationId && !notification.read);
        return {
          ...prev,
          notifications: prev.notifications.map((notification) =>
            notification.id === notificationId ? { ...notification, read: true } : notification,
          ),
          unreadCount: wasUnread ? Math.max(0, prev.unreadCount - 1) : prev.unreadCount,
        };
      });
    } catch {
      // silent
    }
  }, [activeSessionScopeRef, activeWalletAddressRef, normalizedWalletAddress, sessionScope, setSnapshot]);

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    const requestedWalletAddress = normalizedWalletAddress;
    if (!requestedWalletAddress || !sessionScope
      || activeWalletAddressRef.current !== requestedWalletAddress
      || activeSessionScopeRef.current !== sessionScope) return;
    try {
      await fetch(`/api/metadata/notifications/${requestedWalletAddress}/read-all`, { method: "PATCH" });
      if (activeWalletAddressRef.current !== requestedWalletAddress
        || activeSessionScopeRef.current !== sessionScope) return;
      setSnapshot((prev) => isWalletNotificationSnapshotCurrent(prev.walletAddress, requestedWalletAddress)
        && prev.sessionScope === sessionScope
        ? {
          ...prev,
          notifications: prev.notifications.map((notification) => ({ ...notification, read: true })),
          unreadCount: 0,
        }
        : prev);
    } catch {
      // silent
    }
  }, [activeSessionScopeRef, activeWalletAddressRef, normalizedWalletAddress, sessionScope, setSnapshot]);

  // Scope state to the active wallet and invalidate older requests when it changes.
  useEffect(() => {
    activeWalletAddressRef.current = normalizedWalletAddress;
    activeSessionScopeRef.current = sessionScope;
    fetchSequenceRef.current += 1;
    if (!normalizedWalletAddress || !sessionScope) return;

    void fetchNotifications();
    return () => {
      fetchSequenceRef.current += 1;
      if (activeWalletAddressRef.current === normalizedWalletAddress) {
        activeWalletAddressRef.current = null;
      }
      if (activeSessionScopeRef.current === sessionScope) activeSessionScopeRef.current = null;
    };
  }, [activeSessionScopeRef, activeWalletAddressRef, fetchNotifications, normalizedWalletAddress, sessionScope]);

  // WebSocket connection
  useEffect(() => {
    if (!normalizedWalletAddress || !sessionScope) return;

    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    registerDisputeNotificationSocketHandlers(socket, {
      walletAddress: normalizedWalletAddress,
      refetch: fetchNotifications,
      onNotification: (notification) => {
        if (activeWalletAddressRef.current !== normalizedWalletAddress
          || activeSessionScopeRef.current !== sessionScope) return;
        setSnapshot((prev) => prependWalletNotification(prev, normalizedWalletAddress, notification, sessionScope));
      },
      onDisputeStatus: (update) => {
        if (activeWalletAddressRef.current !== normalizedWalletAddress
          || activeSessionScopeRef.current !== sessionScope) return;
        setDisputeUpdateSnapshot({ walletAddress: normalizedWalletAddress, sessionScope, update });
      },
    });

    return () => {
      socket.emit("wallet:leave", normalizedWalletAddress);
      socket.disconnect();
      socketRef.current = null;
    };
  }, [activeSessionScopeRef, activeWalletAddressRef, normalizedWalletAddress, sessionScope, fetchNotifications]);

  return {
    notifications: visibleSnapshot.notifications,
    unreadCount: visibleSnapshot.unreadCount,
    disputeUpdate,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  };
}
