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

    socket.on("connect", () => {
      // Join wallet room for targeted notifications
      socket.emit("wallet:join", walletAddress.toLowerCase());
    });

    // Targeted notification for this wallet
    socket.on("notification.new", (data: Omit<DisputeNotification, "read" | "createdAt">) => {
      setNotifications((prev) => [
        { ...data, read: false, createdAt: new Date().toISOString() } as DisputeNotification,
        ...prev,
      ]);
      setUnreadCount((prev) => prev + 1);
    });

    // Global dispute status updates (for dashboard refresh)
    socket.on("dispute.status", (data: DisputeStatusUpdate) => {
      setDisputeUpdate(data);
    });

    return () => {
      if (walletAddress) {
        socket.emit("wallet:leave", walletAddress.toLowerCase());
      }
      socket.disconnect();
      socketRef.current = null;
    };
  }, [walletAddress]);

  return {
    notifications,
    unreadCount,
    disputeUpdate,
    markAsRead,
    markAllAsRead,
    refetch: fetchNotifications,
  };
}
