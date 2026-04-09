"use client";

import { useState, useRef, useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "../auth/AuthProvider";
import { useDisputeNotifications, DisputeNotification } from "../../hooks/useDisputeNotifications";

const typeIcon = (type: string) => {
  switch (type) {
    case "dispute_filed": return "\ud83d\udce3";
    case "dispute_resolved": return "\u2696\ufe0f";
    case "dispute_appealed": return "\ud83d\udd04";
    case "evidence_submitted": return "\ud83d\udcce";
    default: return "\ud83d\udd14";
  }
};

const timeAgo = (dateStr: string) => {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
};

const subscribe = () => () => {};

export default function NotificationBell() {
  const { address } = useAuth();
  const hasMounted = useSyncExternalStore(subscribe, () => true, () => false);
  const { notifications, unreadCount, markAsRead, markAllAsRead } = useDisputeNotifications(address ?? undefined);
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  const getNotificationHref = (notification: DisputeNotification) => {
    const query = new URLSearchParams();

    if (notification.type === "dispute_filed") {
      query.set("tab", "creator");
    }

    if (notification.disputeId) {
      query.set("dispute", notification.disputeId);
    }

    const queryString = query.toString();
    return queryString ? `/disputes?${queryString}` : "/disputes";
  };

  const handleNotificationClick = async (notification: DisputeNotification) => {
    if (!notification.read) {
      await markAsRead(notification.id);
    }
    setOpen(false);
    router.push(getNotificationHref(notification));
  };

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  if (!hasMounted || !address) return null;


  return (
    <div ref={dropdownRef} style={{ position: "relative", display: "inline-block" }}>
      {/* Bell button */}
      <button
        onClick={() => setOpen(!open)}
        style={bellBtnStyle}
        aria-label="Notifications"
      >
        🔔
        {unreadCount > 0 && (
          <span style={badgeStyle}>{unreadCount > 9 ? "9+" : unreadCount}</span>
        )}
      </button>

      {/* Dropdown */}
      {open && (
        <div style={dropdownStyle}>
          <div style={dropdownHeaderStyle}>
            <span style={{ fontWeight: 600, fontSize: "14px" }}>Notifications</span>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <Link href="/disputes" onClick={() => setOpen(false)} style={openCenterLinkStyle}>
                Open Dispute Center
              </Link>
              {unreadCount > 0 && (
                <button onClick={markAllAsRead} style={markAllBtnStyle}>
                  Mark all read
                </button>
              )}
            </div>
          </div>

          {notifications.length === 0 ? (
            <div style={emptyStyle}>No notifications yet</div>
          ) : (
            <div style={{ maxHeight: "360px", overflowY: "auto" }}>
              {notifications.slice(0, 20).map((n: DisputeNotification) => (
                <div
                  key={n.id}
                  onClick={() => { void handleNotificationClick(n); }}
                  style={{
                    ...itemStyle,
                    background: n.read ? "transparent" : "rgba(99, 102, 241, 0.06)",
                    cursor: "pointer",
                  }}
                >
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                    <div style={{ display: "flex", gap: "8px", flex: 1, minWidth: 0 }}>
                      <span style={{ fontSize: "14px" }}>{typeIcon(n.type)}</span>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 600, fontSize: "12px" }}>{n.title}</div>
                        <div style={{ ...messageStyle }}>
                          {n.message}
                        </div>
                        <div style={notificationActionHintStyle}>
                          View in dispute center →
                        </div>
                      </div>
                    </div>
                    <span style={{ fontSize: "10px", opacity: 0.4, whiteSpace: "nowrap", marginLeft: "8px" }}>
                      {timeAgo(n.createdAt)}
                    </span>
                  </div>
                  {!n.read && <div style={unreadDotStyle} />}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const bellBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  fontSize: "18px",
  cursor: "pointer",
  position: "relative",
  padding: "6px 8px",
};

const badgeStyle: React.CSSProperties = {
  position: "absolute",
  top: "2px",
  right: "2px",
  background: "#ef4444",
  color: "#fff",
  borderRadius: "50%",
  fontSize: "9px",
  fontWeight: 700,
  width: "16px",
  height: "16px",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  lineHeight: 1,
};

const dropdownStyle: React.CSSProperties = {
  position: "absolute",
  top: "100%",
  right: 0,
  width: "340px",
  background: "rgba(20, 20, 30, 0.98)",
  border: "1px solid rgba(255,255,255,0.1)",
  borderRadius: "12px",
  boxShadow: "0 12px 40px rgba(0,0,0,0.5)",
  zIndex: 1000,
  backdropFilter: "blur(20px)",
};

const dropdownHeaderStyle: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  alignItems: "center",
  padding: "12px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.06)",
};

const markAllBtnStyle: React.CSSProperties = {
  background: "none",
  border: "none",
  color: "#60a5fa",
  fontSize: "11px",
  cursor: "pointer",
};

const openCenterLinkStyle: React.CSSProperties = {
  color: "#a78bfa",
  fontSize: "11px",
  fontWeight: 600,
  textDecoration: "none",
};

const emptyStyle: React.CSSProperties = {
  textAlign: "center",
  padding: "30px 14px",
  opacity: 0.3,
  fontSize: "13px",
};

const itemStyle: React.CSSProperties = {
  padding: "10px 14px",
  borderBottom: "1px solid rgba(255,255,255,0.04)",
  position: "relative",
  transition: "background 0.15s",
};

const messageStyle: React.CSSProperties = {
  fontSize: "11px",
  opacity: 0.6,
  marginTop: "2px",
  lineHeight: "1.4",
  overflowWrap: "anywhere",
  wordBreak: "break-word",
};

const notificationActionHintStyle: React.CSSProperties = {
  fontSize: "10px",
  color: "#a78bfa",
  marginTop: "6px",
  fontWeight: 600,
};

const unreadDotStyle: React.CSSProperties = {
  position: "absolute",
  top: "50%",
  right: "10px",
  transform: "translateY(-50%)",
  width: "6px",
  height: "6px",
  borderRadius: "50%",
  background: "#6366f1",
};
