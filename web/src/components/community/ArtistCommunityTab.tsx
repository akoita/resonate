"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  createCommunityRoomMessage,
  deleteCommunityMessage,
  enableArtistCommunity,
  joinCommunityRoom,
  leaveCommunityRoom,
  listArtistCommunityRooms,
  listCommunityRoomMessages,
  moderateCommunityRoomMember,
  reportCommunityMessage,
  type ArtistProfile,
  type CommunityArtistRoom,
  type CommunityArtistRoomsResponse,
  type CommunityMessage,
} from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { useAuth } from "../auth/AuthProvider";
import { Button } from "../ui/Button";

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
        ? "Connect your wallet to privately check holder access."
        : "Connect your wallet to join the conversation.",
    };
  }

  if (room.roomType === "artist_holder" && !room.access.joinable) {
    return {
      label: "Holder access required",
      disabled: true,
      reason: "This room is reserved for eligible holders and supporters. Resonate does not expose wallet holdings publicly.",
    };
  }

  return {
    label: room.roomType === "artist_holder" ? "Join holder room" : "Join room",
    disabled: false,
    reason: room.roomType === "artist_holder"
      ? "Eligibility is checked privately when you join."
      : "Open artist room.",
  };
}

function formatTime(value: string) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function shortUserId(userId: string) {
  return userId.length > 14 ? `${userId.slice(0, 8)}...${userId.slice(-4)}` : userId;
}

function roomKindLabel(room: CommunityArtistRoom) {
  if (room.roomType === "artist_holder") return "Holder room";
  if (room.roomType === "artist_public") return "Public room";
  return "Community room";
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
  const [loadingRooms, setLoadingRooms] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ type: "success" | "error" | "info"; message: string } | null>(null);

  const rooms = useMemo(() => sortArtistCommunityRooms(roomsState?.rooms ?? []), [roomsState]);
  const activeRoom = rooms.find((room) => room.id === activeRoomId) ?? rooms[0] ?? null;
  const activeMessageRoomId = activeRoom?.id ?? null;
  const canReadActiveRoom = Boolean(activeRoom && (canManage || isJoinedRoom(activeRoom)));

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
    if (!token || !activeRoom) return;
    void runAction(`${action}-${message.authorId}`, async () => {
      await moderateCommunityRoomMember(token, activeRoom.id, message.authorId, action);
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
              return (
                <article
                  key={room.id}
                  className={`artist-community-room ${selected ? "artist-community-room--active" : ""}`}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setActiveRoomId(room.id);
                      void recordProductAnalytics(token, "community.room_selected", {
                        subjectType: "community_room",
                        subjectId: room.id,
                        payload: { artistId, roomId: room.id, roomType: room.roomType },
                      });
                    }}
                    className="artist-community-room__select"
                  >
                    <span>{roomKindLabel(room)}</span>
                    <strong>{room.title}</strong>
                    <small>{room.description ?? action.reason}</small>
                  </button>
                  <div className="artist-community-room__meta">
                    <span>{room.status}</span>
                    <span>{isJoinedRoom(room) ? room.membership?.role ?? "member" : action.label}</span>
                  </div>
                  <div className="artist-community-room__actions">
                    {isJoinedRoom(room) ? (
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
                    )}
                  </div>
                  {!isJoinedRoom(room) ? <p className="artist-community-room__reason">{action.reason}</p> : null}
                </article>
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
                        <p>No messages yet.</p>
                      ) : (
                        messages.map((message) => {
                          const ownMessage = message.authorId === userId;
                          return (
                            <article
                              key={message.id}
                              className={`artist-community-message ${message.messageType === "announcement" ? "artist-community-message--announcement" : ""}`}
                            >
                              <div className="artist-community-message__meta">
                                <strong>{message.messageType === "announcement" ? "Artist announcement" : shortUserId(message.authorId)}</strong>
                                <span>{formatTime(message.createdAt)}</span>
                              </div>
                              <p>{message.body}</p>
                              <div className="artist-community-message__actions">
                                <button type="button" onClick={() => setReportingMessageId(message.id)}>
                                  Report
                                </button>
                                {(ownMessage || canManage) ? (
                                  <button type="button" onClick={() => handleDelete(message)}>
                                    Delete
                                  </button>
                                ) : null}
                                {canManage && !ownMessage ? (
                                  <>
                                    <button type="button" onClick={() => handleModerate(message, "remove")}>
                                      Remove member
                                    </button>
                                    <button type="button" onClick={() => handleModerate(message, "ban")}>
                                      Ban
                                    </button>
                                  </>
                                ) : null}
                              </div>
                              {reportingMessageId === message.id ? (
                                <div className="artist-community-report">
                                  <input
                                    value={reportReason}
                                    onChange={(event) => setReportReason(event.target.value)}
                                    aria-label="Report reason"
                                  />
                                  <Button
                                    variant="ghost"
                                    onClick={() => handleReport(message)}
                                    disabled={!reportReason.trim() || busyKey === `report-${message.id}`}
                                  >
                                    Send report
                                  </Button>
                                </div>
                              ) : null}
                            </article>
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
