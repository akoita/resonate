"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  connectArtistDiscordBridge,
  createCommunityRoomMessage,
  deleteCommunityMessage,
  disconnectArtistDiscordBridge,
  enableArtistCommunity,
  getArtistDiscordBridge,
  joinCommunityRoom,
  leaveCommunityRoom,
  listArtistCommunityRooms,
  listCommunityRoomMessages,
  moderateCommunityRoomMember,
  reportCommunityMessage,
  retryArtistDiscordAttempt,
  testArtistDiscordBridge,
  type ArtistProfile,
  type CommunityArtistRoom,
  type CommunityArtistRoomsResponse,
  type CommunityDiscordBridge,
  type CommunityMessage,
} from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../ui/Button";
import { CommunityMessageItem, communityMessageRemoved } from "./CommunityMessageItem";
import { RoomCard } from "./RoomCard";
import { artistRoomAccessModel, roomAccessLockedReason } from "./roomAccess";

type ArtistCommunityTabProps = {
  artistId: string;
  artist: ArtistProfile | null;
};

type RoomActionState = {
  label: string;
  disabled: boolean;
  reason: string;
};

export function sortArtistCommunityRooms(rooms: CommunityArtistRoom[]) {
  const order: Record<string, number> = {
    artist_public: 0,
    artist_holder: 1,
  };
  return [...rooms].sort((a, b) => {
    const orderA = order[a.roomType] ?? 99;
    const orderB = order[b.roomType] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.title.localeCompare(b.title);
  });
}

export function isJoinedRoom(room: CommunityArtistRoom | null | undefined) {
  return room?.membership?.status === "active";
}

export function roomAccessCopy(room: CommunityArtistRoom, authenticated: boolean): RoomActionState {
  if (room.status !== "active") {
    return {
      label: "Room paused",
      disabled: true,
      reason: "This room is not accepting new activity right now.",
    };
  }

  if (isJoinedRoom(room)) {
    return {
      label: "Joined",
      disabled: false,
      reason: "You can read and post in this room.",
    };
  }

  if (!authenticated) {
    return {
      label: "Connect to join",
      disabled: true,
      reason: room.roomType === "artist_holder"
        ? "Connect your wallet to privately check your holder proof."
        : "Connect your wallet to join the conversation.",
    };
  }

  if (room.roomType === "artist_holder" && !room.access.joinable) {
    return {
      label: "Holder access required",
      disabled: true,
      reason: roomAccessLockedReason("holder"),
    };
  }

  return {
    label: room.roomType === "artist_holder" ? "Join holder room" : "Join room",
    disabled: false,
    reason: room.roomType === "artist_holder"
      ? "Your holder proof is checked privately when you join."
      : "Open artist room.",
  };
}

function shortUserId(userId: string) {
  return userId.length > 14 ? `${userId.slice(0, 8)}...${userId.slice(-4)}` : userId;
}

function roomKindLabel(room: CommunityArtistRoom) {
  if (room.roomType === "artist_holder") return "Holder room";
  if (room.roomType === "artist_public") return "Public room";
  return "Community room";
}

export function discordBridgeSummary(bridge: CommunityDiscordBridge | null) {
  if (bridge?.status === "connected") {
    return `Connected to ${bridge.serverName ?? "Discord"}${bridge.channelName ? ` / ${bridge.channelName}` : ""}.`;
  }
  if (bridge?.status === "failed") {
    return `Last Discord sync failed: ${bridge.lastFailureReason ?? "unknown error"}`;
  }
  return "Connect an official Discord webhook to mirror artist announcements.";
}

export function discordBridgeActionLabel(bridge: CommunityDiscordBridge | null) {
  return bridge?.status === "connected" || bridge?.status === "failed"
    ? "Update Discord"
    : "Connect Discord";
}

export function ArtistCommunityTab({ artistId, artist }: ArtistCommunityTabProps) {
  const { token, status, userId, role } = useAuth();
  const authenticated = status === "authenticated" && Boolean(token);
  const canManage = Boolean(
    authenticated && (
      artist?.userId === userId ||
      role === "admin" ||
      role === "operator"
    ),
  );

  const [roomsState, setRoomsState] = useState<CommunityArtistRoomsResponse | null>(null);
  const [activeRoomId, setActiveRoomId] = useState<string | null>(null);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [announcementDraft, setAnnouncementDraft] = useState("");
  const [reportingMessageId, setReportingMessageId] = useState<string | null>(null);
  const [reportReason, setReportReason] = useState("Concern for moderator review");
  const [discordBridge, setDiscordBridge] = useState<CommunityDiscordBridge | null>(null);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState("");
  const [discordInviteUrl, setDiscordInviteUrl] = useState("");
  const [discordServerName, setDiscordServerName] = useState("");
  const [discordChannelName, setDiscordChannelName] = useState("");
  const [discordPublicLinkEnabled, setDiscordPublicLinkEnabled] = useState(false);
  const [discordMirrorEnabled, setDiscordMirrorEnabled] = useState(true);
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const rooms = useMemo(() => sortArtistCommunityRooms(roomsState?.rooms ?? []), [roomsState]);
  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? rooms[0] ?? null;
  const activeMessageRoomId = activeRoom?.id ?? null;
  const canReadActiveRoom = Boolean(activeRoom && (canManage || isJoinedRoom(activeRoom)));
  const publicDiscord = roomsState?.discord ?? null;
  const canSaveDiscordBridge = Boolean(discordWebhookUrl.trim() || discordBridge?.webhookUrlMasked);

  const loadRooms = useCallback(async () => {
    setLoadingRooms(true);
    setNotice(null);
    try {
      const response = await listArtistCommunityRooms(artistId, token);
      const sorted = sortArtistCommunityRooms(response.rooms);
      setRoomsState(response);
      setActiveRoomId((current) => current && sorted.some((room) => room.id === current)
        ? current
        : sorted[0]?.id ?? null);
    } catch (error) {
      setRoomsState(null);
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Could not load artist community rooms.",
      });
    } finally {
      setLoadingRooms(false);
    }
  }, [artistId, token]);

  const loadDiscordBridge = useCallback(async () => {
    if (!token || !canManage) {
      setDiscordBridge(null);
      return;
    }
    try {
      const response = await getArtistDiscordBridge(token, artistId);
      setDiscordBridge(response.bridge);
      if (response.bridge) {
        setDiscordInviteUrl(response.bridge.inviteUrl ?? "");
        setDiscordServerName(response.bridge.serverName ?? "");
        setDiscordChannelName(response.bridge.channelName ?? "");
        setDiscordPublicLinkEnabled(response.bridge.publicLinkEnabled);
        setDiscordMirrorEnabled(Boolean(response.bridge.announcementMirrorEnabled));
      }
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Could not load Discord bridge settings.",
      });
    }
  }, [artistId, canManage, token]);

  const loadMessages = useCallback(async (roomId: string) => {
    if (!token) return;
    setLoadingMessages(true);
    try {
      const response = await listCommunityRoomMessages(token, roomId);
      setMessages(response.messages);
    } catch (error) {
      setMessages([]);
      setNotice({
        type: "info",
        message: error instanceof Error ? error.message : "Join this room to read messages.",
      });
    } finally {
      setLoadingMessages(false);
    }
  }, [token]);

  useEffect(() => {
    void loadRooms();
  }, [loadRooms]);

  useEffect(() => {
    void loadDiscordBridge();
  }, [loadDiscordBridge]);

  useEffect(() => {
    void recordProductAnalytics(token, "community.artist_tab_viewed", {
      subjectType: "artist",
      subjectId: artistId,
      payload: { artistId },
    });
  }, [artistId, token]);

  useEffect(() => {
    setMessages([]);
    if (activeMessageRoomId && canReadActiveRoom) {
      void loadMessages(activeMessageRoomId);
    }
  }, [activeMessageRoomId, canReadActiveRoom, loadMessages]);

  async function runAction(key: string, action: () => Promise<void>) {
    setBusyKey(key);
    setNotice(null);
    try {
      await action();
    } catch (error) {
      setNotice({
        type: "error",
        message: error instanceof Error ? error.message : "Community action failed.",
      });
    } finally {
      setBusyKey(null);
    }
  }

  const handleEnable = () => {
    if (!token) return;
    void runAction("enable", async () => {
      const response = await enableArtistCommunity(token, artistId);
      setRoomsState(response);
      setActiveRoomId(sortArtistCommunityRooms(response.rooms)[0]?.id ?? null);
      setNotice({ type: "success", message: "Artist community rooms are live." });
    });
  };

  const handleJoin = (room: CommunityArtistRoom) => {
    if (!token) return;
    void recordProductAnalytics(token, "community.room_join_clicked", {
      subjectType: "community_room",
      subjectId: room.id,
      payload: { artistId, roomId: room.id, roomType: room.roomType },
    });
    void runAction(`join-${room.id}`, async () => {
      const response = await joinCommunityRoom(token, room.id);
      setRoomsState((current) => current
        ? {
            ...current,
            rooms: current.rooms.map((item) => item.id === room.id ? response.room : item),
          }
        : current);
      setNotice({ type: "success", message: `Joined ${room.title}.` });
      await loadMessages(room.id);
    });
  };

  const handleLeave = (room: CommunityArtistRoom) => {
    if (!token) return;
    void runAction(`leave-${room.id}`, async () => {
      const response = await leaveCommunityRoom(token, room.id);
      setRoomsState((current) => current
        ? {
            ...current,
            rooms: current.rooms.map((item) => item.id === room.id
              ? { ...item, membership: response.membership }
              : item),
          }
        : current);
      setMessages([]);
      setNotice({ type: "success", message: `Left ${room.title}.` });
    });
  };

  const handlePost = (messageType: "message" | "announcement") => {
    if (!token || !activeRoom) return;
    const body = messageType === "announcement" ? announcementDraft.trim() : draft.trim();
    if (!body) return;
    void runAction(`${messageType}-${activeRoom.id}`, async () => {
      const response = await createCommunityRoomMessage(token, activeRoom.id, { body, messageType });
      setMessages((current) => [...current, response.message]);
      if (messageType === "announcement") {
        setAnnouncementDraft("");
      } else {
        setDraft("");
      }
    });
  };

  const handleConnectDiscord = () => {
    if (!token || !canManage) return;
    void runAction("discord-connect", async () => {
      const response = await connectArtistDiscordBridge(token, artistId, {
        webhookUrl: discordWebhookUrl,
        inviteUrl: discordInviteUrl,
        serverName: discordServerName,
        channelName: discordChannelName,
        publicLinkEnabled: discordPublicLinkEnabled,
        announcementMirrorEnabled: discordMirrorEnabled,
      });
      setDiscordBridge(response.bridge);
      setDiscordWebhookUrl("");
      setNotice({ type: "success", message: "Discord bridge connected." });
      await loadRooms();
    });
  };

  const handleTestDiscord = () => {
    if (!token || !canManage) return;
    void runAction("discord-test", async () => {
      const response = await testArtistDiscordBridge(token, artistId);
      setDiscordBridge(response.bridge);
      setNotice({
        type: response.ok ? "success" : "error",
        message: response.ok ? "Discord test message sent." : response.attempt.errorReason ?? "Discord test failed.",
      });
    });
  };

  const handleDisconnectDiscord = () => {
    if (!token || !canManage) return;
    void runAction("discord-disconnect", async () => {
      const response = await disconnectArtistDiscordBridge(token, artistId);
      setDiscordBridge(response.bridge);
      setDiscordWebhookUrl("");
      setNotice({ type: "success", message: "Discord bridge disconnected." });
      await loadRooms();
    });
  };

  const handleRetryDiscord = (attemptId: string) => {
    if (!token || !canManage) return;
    void runAction(`discord-retry-${attemptId}`, async () => {
      const response = await retryArtistDiscordAttempt(token, artistId, attemptId);
      setNotice({
        type: response.ok ? "success" : "error",
        message: response.ok ? "Discord retry completed." : response.attempt.errorReason ?? "Discord retry failed.",
      });
      await loadDiscordBridge();
    });
  };

  const handleReport = (message: CommunityMessage) => {
    if (!token || !reportReason.trim()) return;
    void runAction(`report-${message.id}`, async () => {
      await reportCommunityMessage(token, message.id, reportReason.trim());
      setReportingMessageId(null);
      setReportReason("Concern for moderator review");
      setNotice({ type: "success", message: "Report sent for moderator review." });
    });
  };

  const handleDelete = (message: CommunityMessage) => {
    if (!token) return;
    void runAction(`delete-${message.id}`, async () => {
      await deleteCommunityMessage(token, message.id);
      setMessages((current) => current.filter((item) => item.id !== message.id));
      setNotice({ type: "success", message: "Message removed." });
    });
  };

  const handleModerate = (message: CommunityMessage, action: "remove" | "ban") => {
    if (!token || !activeRoom || !message.authorId) return;
    const authorId = message.authorId;
    void runAction(`${action}-${authorId}`, async () => {
      await moderateCommunityRoomMember(token, activeRoom.id, authorId, action);
      setNotice({ type: "success", message: action === "ban" ? "Member banned." : "Member removed." });
    });
  };

  return (
    <section className="artist-community" aria-label="Artist community">
      <div className="artist-community__header">
        <div>
          <span className="artist-label">Community</span>
          <h2>{artist?.displayName ?? roomsState?.artist.displayName ?? "Artist"} rooms</h2>
          <p>Join the public conversation or enter holder spaces when your wallet qualifies.</p>
        </div>
        <div className="artist-community__header-actions">
          <Button variant="ghost" onClick={loadRooms} disabled={loadingRooms}>
            Refresh
          </Button>
          {canManage && rooms.length === 0 ? (
            <Button onClick={handleEnable} disabled={busyKey === "enable"}>
              Enable rooms
            </Button>
          ) : null}
        </div>
      </div>

      {notice ? (
        <div className={`artist-community__notice artist-community__notice--${notice.type}`}>
          {notice.message}
        </div>
      ) : null}

      {publicDiscord?.inviteUrl ? (
        <div className="artist-community__notice artist-community__notice--info">
          Official Discord:{" "}
          <a href={publicDiscord.inviteUrl} target="_blank" rel="noreferrer">
            {publicDiscord.serverName ?? "Join server"}
          </a>
        </div>
      ) : null}

      {canManage ? (
        <div className="artist-community__empty">
          <strong>Discord bridge</strong>
          <p>
            {discordBridgeSummary(discordBridge)}
          </p>
          <div className="artist-community-composer">
            <label htmlFor="artist-discord-webhook">Webhook URL</label>
            <input
              id="artist-discord-webhook"
              value={discordWebhookUrl}
              onChange={(event) => setDiscordWebhookUrl(event.target.value)}
              placeholder={discordBridge?.webhookUrlMasked ?? "https://discord.com/api/webhooks/..."}
            />
            <label htmlFor="artist-discord-invite">Public invite URL</label>
            <input
              id="artist-discord-invite"
              value={discordInviteUrl}
              onChange={(event) => setDiscordInviteUrl(event.target.value)}
              placeholder="https://discord.gg/..."
            />
            <label htmlFor="artist-discord-server">Server name</label>
            <input
              id="artist-discord-server"
              value={discordServerName}
              onChange={(event) => setDiscordServerName(event.target.value)}
              placeholder="Official server"
            />
            <label htmlFor="artist-discord-channel">Announcement channel</label>
            <input
              id="artist-discord-channel"
              value={discordChannelName}
              onChange={(event) => setDiscordChannelName(event.target.value)}
              placeholder="#announcements"
            />
            <label>
              <input
                type="checkbox"
                checked={discordPublicLinkEnabled}
                onChange={(event) => setDiscordPublicLinkEnabled(event.target.checked)}
              />
              Show official Discord link publicly
            </label>
            <label>
              <input
                type="checkbox"
                checked={discordMirrorEnabled}
                onChange={(event) => setDiscordMirrorEnabled(event.target.checked)}
              />
              Mirror artist announcements
            </label>
            <div className="artist-community__header-actions">
              <Button onClick={handleConnectDiscord} disabled={!canSaveDiscordBridge || busyKey === "discord-connect"}>
                {discordBridgeActionLabel(discordBridge)}
              </Button>
              <Button variant="ghost" onClick={handleTestDiscord} disabled={!discordBridge || busyKey === "discord-test"}>
                Test
              </Button>
              <Button variant="ghost" onClick={handleDisconnectDiscord} disabled={!discordBridge || busyKey === "discord-disconnect"}>
                Disconnect
              </Button>
            </div>
            {discordBridge?.recentAttempts.some((attempt) => attempt.status === "failed") ? (
              <div className="artist-community__rooms" aria-label="Discord retry queue">
                {discordBridge.recentAttempts
                  .filter((attempt) => attempt.status === "failed")
                  .slice(0, 3)
                  .map((attempt) => (
                    <button
                      key={attempt.id}
                      type="button"
                      className="artist-community__notice artist-community__notice--error"
                      onClick={() => handleRetryDiscord(attempt.id)}
                      disabled={busyKey === `discord-retry-${attempt.id}`}
                    >
                      Retry {attempt.action}: {attempt.errorReason ?? "failed"}
                    </button>
                  ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      {loadingRooms ? (
        <div className="artist-community__empty">Loading community rooms...</div>
      ) : rooms.length === 0 ? (
        <div className="artist-community__empty">
          <strong>No community rooms yet</strong>
          <p>{canManage ? "Enable public and holder rooms when this artist is ready to gather listeners." : "This artist has not opened community rooms yet."}</p>
        </div>
      ) : (
        <div className="artist-community__layout">
          <div className="artist-community__rooms" aria-label="Community rooms">
            {rooms.map((room) => {
              const action = roomAccessCopy(room, authenticated);
              const selected = activeRoom?.id === room.id;
              const joinedRoom = isJoinedRoom(room);
              return (
                <RoomCard
                  key={room.id}
                  className="room-card--artist"
                  accessModel={artistRoomAccessModel(room.roomType)}
                  accessLocked={!joinedRoom && action.disabled}
                  eyebrow={roomKindLabel(room)}
                  title={room.title}
                  selected={selected}
                  selectLabel={`Open ${room.title}`}
                  onSelect={() => {
                    setActiveRoomId(room.id);
                    void recordProductAnalytics(token, "community.room_selected", {
                      subjectType: "community_room",
                      subjectId: room.id,
                      payload: { artistId, roomId: room.id, roomType: room.roomType },
                    });
                  }}
                  meta={
                    <>
                      <span>{room.status}</span>
                      <span>{joinedRoom ? room.membership?.role ?? "member" : action.label}</span>
                    </>
                  }
                  actions={
                    joinedRoom ? (
                      <Button variant="ghost" onClick={() => handleLeave(room)} disabled={busyKey === `leave-${room.id}`}>
                        Leave
                      </Button>
                    ) : (
                      <Button
                        onClick={() => handleJoin(room)}
                        disabled={action.disabled || busyKey === `join-${room.id}`}
                      >
                        {action.label}
                      </Button>
                    )
                  }
                >
                  <small>{room.description ?? action.reason}</small>
                  {!joinedRoom ? <p className="artist-community-room__reason">{action.reason}</p> : null}
                </RoomCard>
              );
            })}
          </div>

          <div className="artist-community__conversation">
            {activeRoom ? (
              <>
                <div className="artist-community-conversation__header">
                  <div>
                    <span>{roomKindLabel(activeRoom)}</span>
                    <h3>{activeRoom.title}</h3>
                  </div>
                  <span>{activeRoom.status}</span>
                </div>

                {canManage ? (
                  <div className="artist-community-composer artist-community-composer--announcement">
                    <label htmlFor="artist-community-announcement">Artist announcement</label>
                    <textarea
                      id="artist-community-announcement"
                      value={announcementDraft}
                      onChange={(event) => setAnnouncementDraft(event.target.value)}
                      placeholder="Post an update from the artist team"
                      rows={3}
                    />
                    <Button
                      onClick={() => handlePost("announcement")}
                      disabled={!announcementDraft.trim() || busyKey === `announcement-${activeRoom.id}`}
                    >
                      Post announcement
                    </Button>
                  </div>
                ) : null}

                {!authenticated ? (
                  <div className="artist-community__empty">
                    <strong>Connect to enter</strong>
                    <p>Community messages are available after wallet sign-in and room membership.</p>
                  </div>
                ) : !canReadActiveRoom ? (
                  <div className="artist-community__empty">
                    <strong>{roomAccessCopy(activeRoom, authenticated).label}</strong>
                    <p>{roomAccessCopy(activeRoom, authenticated).reason}</p>
                  </div>
                ) : (
                  <>
                    <div className="artist-community-messages" aria-live="polite">
                      {loadingMessages ? (
                        <p>Loading messages...</p>
                      ) : messages.length === 0 ? (
                        <div className="artist-community__chat-empty">
                          <span className="artist-community__chat-empty-icon" aria-hidden="true">
                            <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
                            </svg>
                          </span>
                          <strong>Be the first voice in the room</strong>
                          <p>This space is live. Drop a message and kick off the conversation with other supporters.</p>
                        </div>
                      ) : (
                        messages.map((message) => {
                          const ownMessage = Boolean(message.authorId && message.authorId === userId);
                          const isAnnouncement = message.messageType === "announcement";
                          const author = isAnnouncement
                            ? "Artist announcement"
                            : message.authorLabel ?? (message.authorId ? shortUserId(message.authorId) : "Member");
                          return (
                            <CommunityMessageItem
                              key={message.id}
                              message={message}
                              author={author}
                              removed={communityMessageRemoved(message)}
                              announcement={isAnnouncement}
                              canReport
                              canDelete={ownMessage || canManage}
                              canRemoveMember={canManage && !ownMessage && Boolean(message.authorId)}
                              canBan={canManage && !ownMessage && Boolean(message.authorId)}
                              onDelete={() => handleDelete(message)}
                              onStartReport={() => setReportingMessageId(message.id)}
                              onRemoveMember={() => handleModerate(message, "remove")}
                              onBan={() => handleModerate(message, "ban")}
                              reporting={reportingMessageId === message.id}
                              reportReason={reportReason}
                              reportBusy={busyKey === `report-${message.id}`}
                              onReportReasonChange={setReportReason}
                              onSubmitReport={() => handleReport(message)}
                              onCancelReport={() => setReportingMessageId(null)}
                            />
                          );
                        })
                      )}
                    </div>

                    {activeRoom.status === "active" ? (
                      <div className="artist-community-composer">
                        <label htmlFor="artist-community-message">Message</label>
                        <textarea
                          id="artist-community-message"
                          value={draft}
                          onChange={(event) => setDraft(event.target.value)}
                          placeholder="Add to the room"
                          rows={3}
                        />
                        <Button
                          onClick={() => handlePost("message")}
                          disabled={!draft.trim() || busyKey === `message-${activeRoom.id}`}
                        >
                          Post message
                        </Button>
                      </div>
                    ) : null}
                  </>
                )}
              </>
            ) : null}
          </div>
        </div>
      )}
    </section>
  );
}
