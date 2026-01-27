"use client";

import PlayerBar from "./PlayerBar";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { PlayerProvider } from "../../lib/playerContext";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <PlayerProvider>
      <div className="app-shell">
        <Sidebar />
        <div className="app-main">
          <Topbar />
          <div className="app-content">{children}</div>
          <PlayerBar />
        </div>
      </div>
    </PlayerProvider>
  );
}
