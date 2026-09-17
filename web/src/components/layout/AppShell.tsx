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
import AnalyticsConsentPrompt from "../analytics/AnalyticsConsentPrompt";
import PlaybackIntentBridge from "../player/PlaybackIntentBridge";

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
        <a className="skip-link" href="#main-content">
          Skip to main content
        </a>
        <Sidebar />
        <div className="app-main">
          <Topbar />
          <main id="main-content" className="app-content" tabIndex={-1}>
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
      {/* #1772: asked from the shell, because the answer gates collection on
        * every screen — and a later policy change must be able to re-ask
        * everyone rather than wait for them to find a settings panel. */}
      <AnalyticsConsentPrompt />
      <PlaybackIntentBridge />
    </PlayerProvider>

  );
}
