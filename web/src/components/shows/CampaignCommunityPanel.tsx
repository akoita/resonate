"use client";

import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../auth/AuthProvider";
import {
  createCommunityRoomMessage,
  listCommunityRoomMessages,
  type CommunityMessage,
} from "../../lib/api";
import { RoomCard } from "../community/RoomCard";
import { campaignRoomAccessModel, roomAccessLockedReason } from "../community/roomAccess";
import {
  createShowCampaignCommunityUpdate,
  getShowCampaignCommunity,
  joinShowCampaignCityDemand,
  joinShowCampaignCommunity,
  type Campaign,
  type ShowCampaignCommunityRoom,
} from "../../lib/shows";

type Notice = { type: "success" | "error"; message: string } | null;

export function isCampaignSupporterRoomJoined(room?: ShowCampaignCommunityRoom | null) {
  return room?.membership?.status === "active";
}

export function isCityDemandRoomJoined(room?: ShowCampaignCommunityRoom | null) {
  return room?.membership?.status === "active";
}

export function campaignCommunityAction(room?: ShowCampaignCommunityRoom | null) {
  if (!room) return { label: "Loading", disabled: true, reason: "Loading supporter room state." };
  if (isCampaignSupporterRoomJoined(room)) {
    return { label: "Joined", disabled: true, reason: "Supporter room access is active." };
  }
  if (room.access?.joinable) {
    return { label: "Join supporter room", disabled: false, reason: "Confirmed campaign support unlocks this room." };
  }
  if (room.access?.reason === "campaign_support_required") {
    return { label: "Support required", disabled: true, reason: roomAccessLockedReason("support") };
  }
  return { label: "Unavailable", disabled: true, reason: "The supporter room is not available right now." };
}

export function canPostCampaignUpdate(role: string | null) {
  return role === "artist" || role === "admin" || role === "operator";
}

export function isCampaignSupporterRoomAvailable(campaign: Pick<Campaign, "campaignLevel" | "rawStatus">) {
  return campaign.campaignLevel === "active_escrow_campaign"
    && ["active", "funded", "booking_confirmed", "deposit_released"].includes(campaign.rawStatus);
}

export function isCityDemandAvailable(campaign: Pick<Campaign, "campaignLevel" | "rawStatus">) {
  if (campaign.campaignLevel === "signal") {
    return ["draft", "active", "funded", "booking_confirmed", "deposit_released"].includes(campaign.rawStatus);
  }
  return ["provisional_campaign", "active_escrow_campaign"].includes(campaign.campaignLevel)
    && ["active", "funded", "booking_confirmed", "deposit_released"].includes(campaign.rawStatus);
}

export function isCampaignCommunityAvailable(campaign: Pick<Campaign, "campaignLevel" | "rawStatus">) {
  return isCityDemandAvailable(campaign) || isCampaignSupporterRoomAvailable(campaign);
}

export function CampaignCommunityPanel({ campaign }: { campaign: Campaign }) {
  const { token, status, role, connect } = useAuth();
  const [supporterRoom, setSupporterRoom] = useState<ShowCampaignCommunityRoom | null>(null);
  const [cityDemandRoom, setCityDemandRoom] = useState<ShowCampaignCommunityRoom | null>(null);
  const [messages, setMessages] = useState<CommunityMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joiningCity, setJoiningCity] = useState(false);
  const [posting, setPosting] = useState(false);
  const [messageBody, setMessageBody] = useState("");
  const [updateBody, setUpdateBody] = useState("");
  const [notice, setNotice] = useState<Notice>(null);

  const joined = isCampaignSupporterRoomJoined(supporterRoom);
  const cityJoined = isCityDemandRoomJoined(cityDemandRoom);
  const action = campaignCommunityAction(supporterRoom);
  const updateAllowed = canPostCampaignUpdate(role);
  const campaignCommunityAvailable = isCampaignCommunityAvailable(campaign);
  const supporterRoomAvailable = isCampaignSupporterRoomAvailable(campaign);
  const cityDemandAvailable = isCityDemandAvailable(campaign);

  const campaignUpdates = useMemo(
    () => messages.filter((message) => message.messageType === "campaign_update"),
    [messages],
  );
  const supporterMessages = useMemo(
    () => messages.filter((message) => message.messageType !== "campaign_update"),
    [messages],
  );

  useEffect(() => {
    if (!token || !campaignCommunityAvailable) {
      setSupporterRoom(null);
      setCityDemandRoom(null);
      setMessages([]);
      return;
    }

    let active = true;
    setLoading(true);
    setNotice(null);
    getShowCampaignCommunity({ campaign, token })
      .then(async (community) => {
        if (!active) return;
        const nextSupporterRoom = community.rooms.find((candidate) => candidate.roomType === "show_campaign_supporter") ?? null;
        const nextCityDemandRoom = community.rooms.find((candidate) => candidate.roomType === "show_city_demand") ?? null;
        setSupporterRoom(nextSupporterRoom);
        setCityDemandRoom(nextCityDemandRoom);
        if (nextSupporterRoom && (isCampaignSupporterRoomJoined(nextSupporterRoom) || updateAllowed)) {
          const response = await listCommunityRoomMessages(token, nextSupporterRoom.id);
          if (active) setMessages(response.messages);
        } else {
          setMessages([]);
        }
      })
      .catch((err) => {
        if (!active) return;
        setNotice({ type: "error", message: err instanceof Error ? err.message : "Could not load campaign room." });
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [campaign, campaignCommunityAvailable, token, updateAllowed]);

  async function refreshMessages(nextRoom = supporterRoom) {
    if (!token || !nextRoom || (!isCampaignSupporterRoomJoined(nextRoom) && !updateAllowed)) return;
    const response = await listCommunityRoomMessages(token, nextRoom.id);
    setMessages(response.messages);
  }

  async function joinRoom() {
    if (!token) {
      await connect();
      return;
    }
    setJoining(true);
    setNotice(null);
    try {
      const result = await joinShowCampaignCommunity({ campaign, token });
      setSupporterRoom(result.room);
      setNotice({ type: "success", message: "Supporter room joined." });
      await refreshMessages(result.room);
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Could not join supporter room." });
    } finally {
      setJoining(false);
    }
  }

  async function joinCityDemand() {
    if (!token) {
      await connect();
      return;
    }
    setJoiningCity(true);
    setNotice(null);
    try {
      const result = await joinShowCampaignCityDemand({ campaign, token });
      setCityDemandRoom(result.room);
      setNotice({ type: "success", message: `${campaign.city} demand group joined.` });
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Could not join city demand." });
    } finally {
      setJoiningCity(false);
    }
  }

  async function postMessage(messageType: "message" | "campaign_update") {
    if (!token || !supporterRoom) return;
    const body = (messageType === "campaign_update" ? updateBody : messageBody).trim();
    if (!body) return;
    setPosting(true);
    setNotice(null);
    try {
      const result = messageType === "campaign_update"
        ? await createShowCampaignCommunityUpdate({ campaign, token, body })
        : await createCommunityRoomMessage(token, supporterRoom.id, { body, messageType: "message" });
      setMessages((current) => [...current, result.message]);
      if (messageType === "campaign_update") setUpdateBody("");
      else setMessageBody("");
    } catch (err) {
      setNotice({ type: "error", message: err instanceof Error ? err.message : "Could not post to the supporter room." });
    } finally {
      setPosting(false);
    }
  }

  if (!campaignCommunityAvailable) {
    return null;
  }

  return (
    <section className="show-community" aria-label="Campaign community">
      <div className="show-community__header">
        <div>
          <span className="shows-home-section__kicker">Campaign community</span>
          <h2 className="shows-home-section__title">Demand starts in {campaign.city}.</h2>
        </div>
        <button
          type="button"
          className="show-community__refresh"
          onClick={() => void refreshMessages()}
          disabled={!supporterRoom || (!joined && !updateAllowed) || loading}
        >
          Refresh
        </button>
      </div>

      {notice ? (
        <p className={`show-community__notice show-community__notice--${notice.type}`} role={notice.type === "error" ? "alert" : "status"}>
          {notice.message}
        </p>
      ) : null}

      {status !== "authenticated" ? (
        <div className="show-community__locked">
          <strong>Connect to join the demand signal</strong>
          <p>Fans can join the city group first. Confirmed campaign support unlocks the private backer room without exposing pledge or wallet details publicly.</p>
          <button type="button" onClick={() => void connect()}>
            Connect wallet
          </button>
        </div>
      ) : (
        <div className="show-community__grid">
          {cityDemandAvailable ? (
            <RoomCard
              className="room-card--campaign show-community__room--city"
              accessModel={campaignRoomAccessModel("show_city_demand")}
              eyebrow="City demand"
              title={cityDemandRoom?.title ?? `${campaign.city} demand group`}
              meta={<span>{cityJoined ? "Demand joined" : "Join city demand"}</span>}
              actions={!cityJoined ? (
                <button
                  type="button"
                  onClick={() => void joinCityDemand()}
                  disabled={joiningCity || !cityDemandRoom?.access?.joinable}
                >
                  {joiningCity ? "Joining..." : `Join ${campaign.city}`}
                </button>
              ) : null}
            >
              <p>
                {loading
                  ? "Checking your city demand state..."
                  : "Signal interest in this city without making a pledge yet."}
              </p>
            </RoomCard>
          ) : null}

          {supporterRoomAvailable ? (
            <RoomCard
              className="room-card--campaign"
              accessModel={campaignRoomAccessModel("show_campaign_supporter")}
              accessLocked={!joined && action.disabled}
              eyebrow="Supporter room"
              title={supporterRoom?.title ?? "Campaign supporter room"}
              meta={<span>{joined ? "Access active" : action.label}</span>}
              actions={!joined ? (
                <button
                  type="button"
                  onClick={() => void joinRoom()}
                  disabled={joining || action.disabled}
                >
                  {joining ? "Joining..." : action.label}
                </button>
              ) : null}
            >
              <p>{loading ? "Checking your campaign support..." : action.reason}</p>
            </RoomCard>
          ) : null}

          {supporterRoomAvailable ? (
            <article className="show-community__updates">
              <div className="show-community__subhead">
                <span>Campaign updates</span>
                <strong>{campaignUpdates.length}</strong>
              </div>
              {campaignUpdates.length ? (
                <div className="show-community__messages">
                  {campaignUpdates.map((message) => (
                    <MessageLine key={message.id} message={message} />
                  ))}
                </div>
              ) : (
                <p className="show-community__empty">No campaign updates yet.</p>
              )}

              {updateAllowed ? (
                <div className="show-community__composer">
                  <textarea
                    value={updateBody}
                    onChange={(event) => setUpdateBody(event.target.value)}
                    placeholder="Post a campaign update..."
                    rows={3}
                  />
                  <button type="button" onClick={() => void postMessage("campaign_update")} disabled={posting || !updateBody.trim()}>
                    Post update
                  </button>
                </div>
              ) : null}
            </article>
          ) : null}

          {joined && supporterRoomAvailable ? (
            <article className="show-community__chat">
              <div className="show-community__subhead">
                <span>Supporter messages</span>
                <strong>{supporterMessages.length}</strong>
              </div>
              {supporterMessages.length ? (
                <div className="show-community__messages">
                  {supporterMessages.map((message) => (
                    <MessageLine key={message.id} message={message} />
                  ))}
                </div>
              ) : (
                <p className="show-community__empty">No supporter messages yet.</p>
              )}
              <div className="show-community__composer">
                <textarea
                  value={messageBody}
                  onChange={(event) => setMessageBody(event.target.value)}
                  placeholder="Message the supporter room..."
                  rows={3}
                />
                <button
                  type="button"
                  onClick={() => void postMessage("message")}
                  disabled={posting || !messageBody.trim()}
                >
                  Send
                </button>
              </div>
            </article>
          ) : null}
        </div>
      )}
    </section>
  );
}

function MessageLine({ message }: { message: CommunityMessage }) {
  return (
    <article className={`show-community-message show-community-message--${message.messageType}`}>
      <p>{message.body}</p>
      <span>{new Date(message.createdAt).toLocaleString()}</span>
    </article>
  );
}
