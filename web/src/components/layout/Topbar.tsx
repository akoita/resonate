"use client";

import type React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import ConnectButton from "../auth/ConnectButton";
import NotificationBell from "../notifications/NotificationBell";
import { useUIStore } from "../../lib/uiStore";

export type TopbarProps = {
  title?: string;
  actions?: React.ReactNode;
};

const ROUTE_TITLES: Array<[string, string]> = [
  ["/agent", "AI DJ"],
  ["/sonic-radar", "Sonic Radar"],
  ["/player", "Player"],
  ["/library", "Library"],
  ["/create", "Create"],
  ["/shows", "Shows"],
  ["/marketplace", "Marketplace"],
  ["/playlists", "Playlists"],
  ["/artist/analytics", "Analytics"],
  ["/analytics/agent-quality", "AI DJ Quality"],
  ["/admin/community/moderation", "Community Moderation"],
  ["/admin/community/cohorts", "Community Cohorts"],
  ["/artist/catalog", "Catalog"],
  ["/artist/upload", "Upload"],
  ["/wallet", "Wallet"],
  ["/disputes", "Disputes"],
  ["/settings", "Settings"],
  ["/help", "User Guide"],
  ["/about", "About"],
];

function getRouteTitle(pathname: string | null) {
  if (!pathname || pathname === "/") return "Discover";
  return ROUTE_TITLES.find(([route]) => pathname === route || pathname.startsWith(`${route}/`))?.[1] ?? "Discover";
}

export default function Topbar({ title, actions }: TopbarProps) {
  const pathname = usePathname();
  const { togglePlaylistPanel, isPlaylistPanelOpen, toggleSidebar, isSidebarOpen } = useUIStore();

  return (
    <div className="app-topbar">
      <div className="topbar-leading">
        <button
          type="button"
          className="hamburger-btn"
          onClick={toggleSidebar}
          aria-label={isSidebarOpen ? "Close navigation" : "Open navigation"}
          aria-expanded={isSidebarOpen}
        >
          <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="topbar-title">{title ?? getRouteTitle(pathname)}</div>
      </div>
      <div className="topbar-actions">
        <button
          className={`topbar-playlist-btn ${isPlaylistPanelOpen ? 'active' : ''}`}
          onClick={togglePlaylistPanel}
          title="Toggle Playlist Panel (Ctrl+J)"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect>
            <line x1="15" y1="3" x2="15" y2="21"></line>
          </svg>
        </button>
        <Link
          href="/help"
          className={`topbar-help-btn ${pathname === "/help" || pathname?.startsWith("/help/") ? "active" : ""}`}
          aria-label="Open the User Guide"
          title="User Guide & help"
        >
          <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
            <line x1="12" y1="17" x2="12.01" y2="17" />
          </svg>
        </Link>
        <NotificationBell />
        {actions ?? <ConnectButton />}
      </div>
    </div>
  );
}
