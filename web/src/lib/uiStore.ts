import { create } from 'zustand';
import { LocalTrack } from './localLibrary';

interface UIState {
    isPlaylistPanelOpen: boolean;
    openPlaylistPanel: () => void;
    closePlaylistPanel: () => void;
    togglePlaylistPanel: () => void;
    tracksToAddToPlaylist: LocalTrack[] | null;
    setTracksToAddToPlaylist: (tracks: LocalTrack[] | null) => void;
    resaleModal: {
        isOpen: boolean;
        stemId: string;
        tokenId: string;
        stemTitle: string;
        onSuccess?: () => void;
    } | null;
    setResaleModal: (modal: { stemId: string; tokenId: string; stemTitle: string; onSuccess?: () => void } | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
    isPlaylistPanelOpen: false,
    openPlaylistPanel: () => set({ isPlaylistPanelOpen: true }),
    closePlaylistPanel: () => set({ isPlaylistPanelOpen: false }),
    togglePlaylistPanel: () => set((state) => ({ isPlaylistPanelOpen: !state.isPlaylistPanelOpen })),
    tracksToAddToPlaylist: null,
    setTracksToAddToPlaylist: (tracks) => set({ tracksToAddToPlaylist: tracks }),
    resaleModal: null,
    setResaleModal: (modal) => set({
        resaleModal: modal ? { ...modal, isOpen: true } : null
    }),
}));
