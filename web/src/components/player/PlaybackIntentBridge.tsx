"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  confirmPlaybackCommand,
  getPlaybackIntentStatus,
  getReleaseArtworkUrl,
  getReleaseTrackStreamUrl,
  getStemPreviewUrl,
  getTrack,
  registerPlaybackDevice,
  type PlaybackIntentCommand,
  type Track,
} from "../../lib/api";
import type { LocalTrack } from "../../lib/localLibrary";
import { useAuth } from "../auth/AuthProvider";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import { useToast } from "../ui/Toast";
import { usePlayer } from "../../lib/playerContext";

const DEVICE_STORAGE_KEY = "resonate.playback.deviceId";
const DEVICE_HEARTBEAT_MS = 20_000;
const COMMAND_POLL_MS = 5_000;

type PlaybackIntentStatusResponse =
  | PlaybackIntentCommand
  | {
      ownerUserId: string;
      commands: PlaybackIntentCommand[];
    };

export function getOrCreatePlaybackDeviceId() {
  if (typeof window === "undefined") {
    return "web-player-ssr";
  }
  const existing = window.localStorage.getItem(DEVICE_STORAGE_KEY);
  if (existing) {
    return existing;
  }
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? `web-player-${crypto.randomUUID()}`
      : `web-player-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(DEVICE_STORAGE_KEY, id);
  return id;
}

export function selectPendingPlaybackCommand(
  response: PlaybackIntentStatusResponse,
  processedCommandIds: Set<string>,
) {
  const commands = "commands" in response ? response.commands : [response];
  return commands.find((command) => {
    if (!command || processedCommandIds.has(command.commandId) || command.confirmedAt) {
      return false;
    }
    if (command.action === "play") {
      return command.status === "pending_confirmation" || command.outcome === "confirmation_required";
    }
    if (command.action === "queue") {
      return command.status === "queued" && command.outcome === "queued";
    }
    return ["pause", "resume", "skip", "stop"].includes(command.action) && command.status === "queued";
  }) ?? null;
}

export function mapCatalogTrackToLocalTrack(track: Track): LocalTrack {
  const release = track.release;
  const releaseId = release?.id || track.releaseId;
  const catalogTrackId = track.id;
  return {
    id: catalogTrackId,
    title: track.title,
    artist: track.artist || release?.artist?.displayName || release?.primaryArtist || null,
    albumArtist: release?.artist?.displayName || release?.primaryArtist || null,
    album: release?.title || null,
    year: release?.releaseDate ? Number.parseInt(release.releaseDate.slice(0, 4), 10) || null : null,
    genre: release?.genre || null,
    duration: null,
    createdAt: track.createdAt || new Date().toISOString(),
    source: "remote",
    catalogTrackId,
    artistId: release?.artist?.id || release?.artistId || null,
    releaseId,
    remoteUrl: releaseId ? getReleaseTrackStreamUrl(releaseId, catalogTrackId) : undefined,
    remoteArtworkUrl: releaseId
      ? release?.artworkUrl || (release?.artworkMimeType ? getReleaseArtworkUrl(releaseId) : undefined)
      : undefined,
    stems: track.stems?.map((stem) => {
      const mixerStem = isMixerStemType(stem.type);
      return {
        id: stem.id,
        uri: mixerStem ? getStemPreviewUrl(stem.id) : stem.uri,
        type: stem.type,
        durationSeconds: stem.durationSeconds,
        isEncrypted: mixerStem ? false : stem.isEncrypted,
        encryptionMetadata: mixerStem ? null : stem.encryptionMetadata,
      };
    }),
    available: true,
  };
}

export default function PlaybackIntentBridge() {
  const { status, token } = useAuth();
  const { addToast } = useToast();
  const {
    playQueue,
    addToQueue,
    stop,
    nextTrack,
    togglePlay,
    isPlaying,
  } = usePlayer();
  const [deviceId, setDeviceId] = useState<string | null>(null);
  const [pendingCommand, setPendingCommand] = useState<PlaybackIntentCommand | null>(null);
  const processedCommandIdsRef = useRef<Set<string>>(new Set());
  const commandInFlightRef = useRef(false);

  useEffect(() => {
    setDeviceId(getOrCreatePlaybackDeviceId());
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !token || !deviceId) {
      return;
    }

    let cancelled = false;
    const heartbeat = async () => {
      try {
        await registerPlaybackDevice(token, {
          deviceId,
          label: "Web player",
          active: true,
          state: isPlaying ? "playing" : "idle",
          supports: [
            "playback.intent",
            "playback.resolve",
            "playback.queue",
            "playback.play",
            "playback.control",
            "playback.status",
          ],
        });
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to register playback device:", error);
        }
      }
    };

    void heartbeat();
    const interval = window.setInterval(() => {
      void heartbeat();
    }, DEVICE_HEARTBEAT_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [deviceId, isPlaying, status, token]);

  const loadCommandTracks = useCallback(async (command: PlaybackIntentCommand) => {
    if (!token || command.trackIds.length === 0) {
      return [];
    }
    const tracks = await Promise.all(
      command.trackIds.map(async (trackId) => mapCatalogTrackToLocalTrack(await getTrack(trackId, token))),
    );
    return tracks.filter(Boolean);
  }, [token]);

  const confirmCommand = useCallback(async (
    command: PlaybackIntentCommand,
    outcome: "queued" | "playing" | "blocked_by_policy" | "unavailable",
    options?: { currentTrackId?: string; reason?: string },
  ) => {
    if (!token) return;
    await confirmPlaybackCommand(token, command.commandId, {
      deviceId: command.deviceId || deviceId || undefined,
      outcome,
      currentTrackId: options?.currentTrackId,
      reason: options?.reason,
    });
    processedCommandIdsRef.current.add(command.commandId);
  }, [deviceId, token]);

  const applyQueueCommand = useCallback(async (command: PlaybackIntentCommand) => {
    const tracks = await loadCommandTracks(command);
    if (tracks.length === 0) {
      await confirmCommand(command, "unavailable", { reason: "track_not_found" });
      return;
    }
    tracks.forEach((track) => addToQueue(track));
    await confirmCommand(command, "queued", { currentTrackId: tracks[0]?.catalogTrackId || tracks[0]?.id });
    addToast({
      type: "success",
      title: "Agent queue updated",
      message: tracks.length === 1 ? `Queued "${tracks[0].title}".` : `Queued ${tracks.length} tracks.`,
    });
  }, [addToQueue, addToast, confirmCommand, loadCommandTracks]);

  const applyControlCommand = useCallback(async (command: PlaybackIntentCommand) => {
    if (command.action === "pause" && isPlaying) {
      togglePlay();
    } else if (command.action === "resume" && !isPlaying) {
      togglePlay();
    } else if (command.action === "skip") {
      nextTrack();
    } else if (command.action === "stop") {
      stop();
    }
    await confirmCommand(command, "queued");
  }, [confirmCommand, isPlaying, nextTrack, stop, togglePlay]);

  useEffect(() => {
    if (status !== "authenticated" || !token || !deviceId) {
      return;
    }

    let cancelled = false;
    const poll = async () => {
      if (commandInFlightRef.current || pendingCommand) {
        return;
      }
      let waitingForConfirmation = false;
      try {
        const response = await getPlaybackIntentStatus(token);
        if (cancelled) return;
        const command = selectPendingPlaybackCommand(response as PlaybackIntentStatusResponse, processedCommandIdsRef.current);
        if (!command) return;

        if (command.deviceId && command.deviceId !== deviceId) {
          processedCommandIdsRef.current.add(command.commandId);
          return;
        }

        commandInFlightRef.current = true;
        if (command.action === "play") {
          waitingForConfirmation = true;
          setPendingCommand(command);
          return;
        }
        if (command.action === "queue") {
          await applyQueueCommand(command);
        } else {
          await applyControlCommand(command);
        }
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to poll playback commands:", error);
        }
      } finally {
        if (!waitingForConfirmation) {
          commandInFlightRef.current = false;
        }
      }
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, COMMAND_POLL_MS);

    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [applyControlCommand, applyQueueCommand, deviceId, pendingCommand, status, token]);

  const pendingTitle = useMemo(() => {
    if (!pendingCommand) return "Start playback?";
    const count = pendingCommand.trackIds.length;
    return count > 1 ? `Start ${count} agent-picked tracks?` : "Start agent-picked playback?";
  }, [pendingCommand]);

  const acceptPendingCommand = useCallback(async () => {
    const command = pendingCommand;
    if (!command) return;
    try {
      const tracks = await loadCommandTracks(command);
      if (tracks.length === 0) {
        await confirmCommand(command, "unavailable", { reason: "track_not_found" });
        addToast({ type: "warning", title: "Playback unavailable", message: "The requested track is no longer available." });
        return;
      }
      await playQueue(tracks, 0);
      await confirmCommand(command, "playing", { currentTrackId: tracks[0].catalogTrackId || tracks[0].id });
      addToast({ type: "success", title: "Agent playback started", message: `Playing "${tracks[0].title}".` });
    } catch (error) {
      await confirmCommand(command, "unavailable", { reason: "client_playback_failed" });
      addToast({
        type: "error",
        title: "Could not start playback",
        message: error instanceof Error ? error.message : "The browser could not start the requested track.",
      });
    } finally {
      setPendingCommand(null);
      commandInFlightRef.current = false;
    }
  }, [addToast, confirmCommand, loadCommandTracks, pendingCommand, playQueue]);

  const declinePendingCommand = useCallback(async () => {
    const command = pendingCommand;
    if (!command) return;
    try {
      await confirmCommand(command, "blocked_by_policy", { reason: "listener_declined" });
      addToast({ type: "info", title: "Agent playback declined", message: "The request was blocked by listener confirmation." });
    } catch (error) {
      console.warn("Failed to confirm declined playback command:", error);
      processedCommandIdsRef.current.add(command.commandId);
    } finally {
      setPendingCommand(null);
      commandInFlightRef.current = false;
    }
  }, [addToast, confirmCommand, pendingCommand]);

  return (
    <ConfirmDialog
      isOpen={!!pendingCommand}
      title={pendingTitle}
      message="A trusted playback agent wants to start sound on this browser. Review the context before allowing playback."
      confirmLabel="Play"
      cancelLabel="Decline"
      variant="default"
      onConfirm={acceptPendingCommand}
      onCancel={declinePendingCommand}
    />
  );
}

function isMixerStemType(type?: string | null) {
  const normalized = type?.trim().toLowerCase();
  return !!normalized && normalized !== "original" && normalized !== "master";
}
