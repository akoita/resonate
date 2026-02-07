"use client";

import { Suspense } from "react";
import PlayerBar from "./PlayerBar";
import Sidebar from "./Sidebar";
import Topbar from "./Topbar";
import { PlayerProvider } from "../../lib/playerContext";
import { GlobalPlaylistPanel } from "./GlobalPlaylistPanel";
import { useUIStore } from "../../lib/uiStore";
import { AddToPlaylistModal } from "../library/AddToPlaylistModal";
import { ResaleModal } from "../marketplace/ResaleModal";
import AgentOnboardingGate from "../agent/AgentOnboardingGate";

export default function AppShell({
  children,
}: {
  children: React.ReactNode;
}) {
  const {
    isPlaylistPanelOpen,
    closePlaylistPanel,
    tracksToAddToPlaylist,
    setTracksToAddToPlaylist,
    resaleModal,
    setResaleModal
  } = useUIStore();

  return (
    <PlayerProvider>
      <div className={`app-shell ${isPlaylistPanelOpen ? 'has-sidebar' : ''}`}>
        <Sidebar />
        <div className="app-main">
          <Topbar />
          <main className="app-content">
            <Suspense fallback={null}>
              {children}
            </Suspense>
          </main>
          <PlayerBar />
        </div>
        <GlobalPlaylistPanel isOpen={isPlaylistPanelOpen} onClose={closePlaylistPanel} />
        <AddToPlaylistModal
          tracks={tracksToAddToPlaylist}
          onClose={() => setTracksToAddToPlaylist(null)}
        />
        <ResaleModal
          modal={resaleModal}
          onClose={() => setResaleModal(null)}
        />
      </div>
      <AgentOnboardingGate />
    </PlayerProvider>

  );
}
