"use client";

import type React from "react";
import ConnectButton from "../auth/ConnectButton";
import { useUIStore } from "../../lib/uiStore";

export type TopbarProps = {
  title?: string;
  actions?: React.ReactNode;
};

export default function Topbar({ title, actions }: TopbarProps) {
  const { togglePlaylistPanel, isPlaylistPanelOpen } = useUIStore();

  return (
    <div className="app-topbar">
      <div>{title ?? "Discover"}</div>
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
        {actions ?? <ConnectButton />}
      </div>
    </div>
  );
}
