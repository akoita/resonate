"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { io, Socket } from "socket.io-client";

const SOCKET_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

export interface DisputeNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  disputeId?: string;
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
  timestamp?: string;
}

export function normalizeIncomingNotification(data: IncomingNotificationEvent): DisputeNotification {
  return {
    id: data.id,
    type: data.type,
    title: data.title,
    message: data.message,
    disputeId: data.disputeId,
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
  const [notifications, setNotifications] = useState<DisputeNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [disputeUpdate, setDisputeUpdate] = useState<DisputeStatusUpdate | null>(null);
  const socketRef = useRef<Socket | null>(null);

  // Fetch notifications from REST API
  const fetchNotifications = useCallback(async () => {
    if (!walletAddress) return;
    try {
      const res = await fetch(`/api/metadata/notifications/${walletAddress}`);
      if (res.ok) {
        const data = await res.json();
        setNotifications(data.notifications || []);
        setUnreadCount(data.unreadCount || 0);
      }
    } catch {
      // silent
    }
  }, [walletAddress]);

  // Mark single notification as read
  const markAsRead = useCallback(async (notificationId: string) => {
    try {
      await fetch(`/api/metadata/notifications/${notificationId}/read`, { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => (n.id === notificationId ? { ...n, read: true } : n)));
      setUnreadCount((prev) => Math.max(0, prev - 1));
    } catch {
      // silent
    }
  }, []);

  // Mark all as read
  const markAllAsRead = useCallback(async () => {
    if (!walletAddress) return;
    try {
      await fetch(`/api/metadata/notifications/${walletAddress}/read-all`, { method: "PATCH" });
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnreadCount(0);
    } catch {
      // silent
    }
  }, [walletAddress]);

  // Fetch on mount / wallet change
  useEffect(() => {
    if (!walletAddress) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/metadata/notifications/${walletAddress}`);
        if (res.ok && !cancelled) {
          const data = await res.json();
          setNotifications(data.notifications || []);
          setUnreadCount(data.unreadCount || 0);
        }
      } catch {
        // silent
      }
    })();
    return () => { cancelled = true; };
  }, [walletAddress]);

  // WebSocket connection
  useEffect(() => {
    if (!walletAddress) return;

    const socket = io(SOCKET_URL, {
      transports: ["websocket", "polling"],
      reconnectionAttempts: 10,
      reconnectionDelay: 1000,
    });
    socketRef.current = socket;

    registerDisputeNotificationSocketHandlers(socket, {
      walletAddress,
      refetch: fetchNotifications,
      onNotification: (notification) => {
        setNotifications((prev) => [notification, ...prev]);
        setUnreadCount((prev) => prev + 1);
      },
      onDisputeStatus: setDisputeUpdate,
    });

    return () => {
      if (walletAddress) {
        socket.emit("wallet:leave", walletAddress.toLowerCase());
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [walletAddress, fetchNotifications]);

  return {
    notifications,
    unreadCount,
    disputeUpdate,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  };
}
