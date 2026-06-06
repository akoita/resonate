"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCommunityCohortDetail,
  getCommunityCohortRoom,
  getCommunityCohortSuggestions,
  getMyCommunityProfile,
  hideCommunityCohort,
  joinCommunityCohortRoom,
  joinCommunityCohort,
  leaveCommunityCohort,
  type CommunityCohort,
  type CommunityCohortDetailResponse,
  type CommunityCohortRoomResponse,
  type CommunityCohortSuggestionsResponse,
  type CommunityVisibilitySettings,
} from "../../lib/api";
import { Button } from "../ui/Button";
import CohortRoomConversation from "../community/CohortRoomConversation";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

type CohortAction = "join" | "leave" | "hide";

type ListenerCohortsContentProps = {
  suggestions: CommunityCohortSuggestionsResponse | null;
  selectedCohortId: string | null;
  detail: CommunityCohortDetailResponse | null;
  cohortRoom: CommunityCohortRoomResponse | null;
  loading: boolean;
  detailLoading: boolean;
  roomLoading: boolean;
  detailError: string | null;
  roomError: string | null;
  consentEnabled: boolean;
  actionId: string | null;
  onRefresh: () => void;
  onOpenDetail: (cohort: CommunityCohort) => void;
  onCloseDetail: () => void;
  onLoadRoom: (cohort: CommunityCohort) => void;
  onJoinRoom: (cohort: CommunityCohort) => void;
  onJoin: (cohort: CommunityCohort) => void;
  onLeave: (cohort: CommunityCohort) => void;
  onHide: (cohort: CommunityCohort) => void;
};

export function cohortTypeLabel(type: string) {
  const labels: Record<string, string> = {
    taste: "Taste",
    artist_affinity: "Artist affinity",
    city_scene: "City scene",
    collector: "Collector",
    campaign: "Campaign",
  };
  return labels[type] ?? "Community";
}

export function cohortPrimaryAction(cohort: CommunityCohort): CohortAction | null {
  if (cohort.membership.status === "joined") return "leave";
  if (cohort.membership.status === "suggested" || cohort.membership.status === "left") return "join";
  return null;
}

export function cohortReasonLabel(cohort: CommunityCohort) {
  const reasonLabels: Record<string, string> = {
    taste: "Shared listening signal",
    artist_affinity: "Artist affinity signal",
    city_scene: "Scene discovery signal",
    collector: "Collector signal",
    campaign: "Campaign community signal",
  };
  return reasonLabels[cohort.cohortType] ?? "Community signal";
}

export function cohortStatusLabel(status: string) {
  const labels: Record<string, string> = {
    suggested: "Suggested",
    joined: "Joined",
    left: "Left",
    hidden: "Hidden",
  };
  return labels[status] ?? `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function replaceCohort(cohorts: CommunityCohort[], next: CommunityCohort) {
  return cohorts.map((cohort) => (cohort.id === next.id ? next : cohort));
}

export function hasVisibleSelectedCohort(cohorts: CommunityCohort[], selectedCohortId: string | null) {
  if (!selectedCohortId) return true;
  return cohorts.some((cohort) => cohort.id === selectedCohortId && cohort.membership.status !== "hidden");
}

export default function ListenerCohortsPanel({ token, addToast }: Props) {
  const [suggestions, setSuggestions] = useState<CommunityCohortSuggestionsResponse | null>(null);
  const [visibility, setVisibility] = useState<CommunityVisibilitySettings | null>(null);
  const [selectedCohortId, setSelectedCohortId] = useState<string | null>(null);
  const [detail, setDetail] = useState<CommunityCohortDetailResponse | null>(null);
  const [cohortRoom, setCohortRoom] = useState<CommunityCohortRoomResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [roomLoading, setRoomLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [roomError, setRoomError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const selectedCohortIdRef = useRef<string | null>(null);
  const detailRequestIdRef = useRef(0);
  const roomRequestIdRef = useRef(0);

  const clearDetailSelection = () => {
    detailRequestIdRef.current += 1;
    roomRequestIdRef.current += 1;
    selectedCohortIdRef.current = null;
    setSelectedCohortId(null);
    setDetail(null);
    setCohortRoom(null);
    setDetailError(null);
    setRoomError(null);
    setDetailLoading(false);
    setRoomLoading(false);
  };

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      const [nextSuggestions, profile] = await Promise.all([
        getCommunityCohortSuggestions(token),
        getMyCommunityProfile(token),
      ]);
      const nextConsentEnabled = Boolean(profile.visibility.allowTasteMatching || profile.visibility.allowCityScenes);
      setSuggestions(nextSuggestions);
      setVisibility(profile.visibility);
      if (!nextConsentEnabled || !hasVisibleSelectedCohort(nextSuggestions.cohorts, selectedCohortIdRef.current)) {
        clearDetailSelection();
      }
    } catch {
      addToast({
        type: "error",
        title: "Cohorts unavailable",
        message: "Could not load your listener cohort suggestions.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token changes are the reload boundary.
  }, [token]);

  const loadDetail = async (cohortId: string) => {
    if (!token) return;
    const requestId = detailRequestIdRef.current + 1;
    detailRequestIdRef.current = requestId;
    roomRequestIdRef.current += 1;
    selectedCohortIdRef.current = cohortId;
    setSelectedCohortId(cohortId);
    setDetail(null);
    setCohortRoom(null);
    setDetailLoading(true);
    setDetailError(null);
    setRoomError(null);
    try {
      const response = await getCommunityCohortDetail(token, cohortId);
      if (detailRequestIdRef.current !== requestId) return;
      setDetail(response);
      if (response.cohort.membership.status === "joined") {
        void loadCohortRoom(cohortId);
      }
    } catch {
      if (detailRequestIdRef.current !== requestId) return;
      setDetail(null);
      setDetailError("This cohort is no longer available for your current visibility settings.");
    } finally {
      if (detailRequestIdRef.current === requestId) {
        setDetailLoading(false);
      }
    }
  };

  const loadCohortRoom = async (cohortId: string) => {
    if (!token) return;
    const requestId = roomRequestIdRef.current + 1;
    roomRequestIdRef.current = requestId;
    setRoomLoading(true);
    setRoomError(null);
    try {
      const response = await getCommunityCohortRoom(token, cohortId);
      if (roomRequestIdRef.current !== requestId) return;
      setCohortRoom(response);
    } catch (error) {
      if (roomRequestIdRef.current !== requestId) return;
      setCohortRoom(null);
      setRoomError(error instanceof Error ? error.message : "This cohort room is not currently available.");
    } finally {
      if (roomRequestIdRef.current === requestId) {
        setRoomLoading(false);
      }
    }
  };

  const handleAction = async (action: CohortAction, cohort: CommunityCohort) => {
    if (!token) return;
    setActionId(`${action}:${cohort.id}`);
    try {
      if (action === "join") {
        const response = await joinCommunityCohort(token, cohort.id);
        setSuggestions((current) => current ? { ...current, cohorts: replaceCohort(current.cohorts, response.cohort) } : current);
        if (selectedCohortId === cohort.id) {
          void loadDetail(cohort.id);
        }
        addToast({ type: "success", title: "Cohort joined", message: "This listener group is now part of your community surface." });
      } else if (action === "leave") {
        const response = await leaveCommunityCohort(token, cohort.id);
        setSuggestions((current) => current ? { ...current, cohorts: replaceCohort(current.cohorts, response.cohort) } : current);
        if (selectedCohortId === cohort.id) {
          clearDetailSelection();
        }
        addToast({ type: "info", title: "Cohort left", message: "You can rejoin while the cohort remains available." });
      } else {
        await hideCommunityCohort(token, cohort.id);
        setSuggestions((current) => current ? { ...current, cohorts: current.cohorts.filter((item) => item.id !== cohort.id) } : current);
        if (selectedCohortId === cohort.id) {
          clearDetailSelection();
        }
        addToast({ type: "info", title: "Cohort hidden", message: "This suggestion will stay out of your cohort list." });
      }
    } catch {
      addToast({ type: "error", title: "Cohort action failed", message: "Please refresh and try again." });
    } finally {
      setActionId(null);
    }
  };

  const handleJoinRoom = async (cohort: CommunityCohort) => {
    if (!token) return;
    setActionId(`join-room:${cohort.id}`);
    try {
      const response = await joinCommunityCohortRoom(token, cohort.id);
      setCohortRoom((current) => current ? { ...current, room: response.room } : current);
      addToast({ type: "success", title: "Cohort room joined", message: "You can now post in this cohort room." });
    } catch (error) {
      addToast({
        type: "error",
        title: "Could not join cohort room",
        message: error instanceof Error ? error.message : "The cohort room is not currently available.",
      });
    } finally {
      setActionId(null);
    }
  };

  const consentEnabled = Boolean(visibility?.allowTasteMatching || visibility?.allowCityScenes);

  return (
    <ListenerCohortsContent
      suggestions={suggestions}
      selectedCohortId={selectedCohortId}
      detail={detail}
      cohortRoom={cohortRoom}
      loading={loading}
      detailLoading={detailLoading}
      roomLoading={roomLoading}
      detailError={detailError}
      roomError={roomError}
      consentEnabled={consentEnabled}
      actionId={actionId}
      onRefresh={load}
      onOpenDetail={(cohort) => void loadDetail(cohort.id)}
      onCloseDetail={clearDetailSelection}
      onLoadRoom={(cohort) => void loadCohortRoom(cohort.id)}
      onJoinRoom={(cohort) => void handleJoinRoom(cohort)}
      onJoin={(cohort) => handleAction("join", cohort)}
      onLeave={(cohort) => handleAction("leave", cohort)}
      onHide={(cohort) => handleAction("hide", cohort)}
    />
  );
}

export function ListenerCohortsContent({
  suggestions,
  selectedCohortId,
  detail,
  cohortRoom,
  loading,
  detailLoading,
  roomLoading,
  detailError,
  roomError,
  consentEnabled,
  actionId,
  onRefresh,
  onOpenDetail,
  onCloseDetail,
  onLoadRoom,
  onJoinRoom,
  onJoin,
  onLeave,
  onHide,
}: ListenerCohortsContentProps) {
  const cohorts = useMemo(
    () => suggestions?.cohorts.filter((cohort) => cohort.membership.status !== "hidden") ?? [],
    [suggestions],
  );
  const selectedCohort = useMemo(
    () => cohorts.find((cohort) => cohort.id === selectedCohortId) ?? null,
    [cohorts, selectedCohortId],
  );
  const detailPanelRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!selectedCohortId) return;
    const node = detailPanelRef.current;
    if (!node) return;
    node.scrollIntoView({ behavior: "smooth", block: "nearest" });
    node.focus({ preventScroll: true });
  }, [selectedCohortId]);

  useEffect(() => {
    if (!selectedCohortId) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCloseDetail();
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedCohortId, onCloseDetail]);

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <h3 className="settings-section-title">Listener Cohorts</h3>
          <p className="home-subtitle">
            Join privacy-safe groups shaped by shared music signals, artist affinity, scene context, collecting, or campaigns.
          </p>
        </div>
        <Button variant="ghost" onClick={onRefresh} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      {!consentEnabled && !loading ? (
        <div className="listener-cohorts-state listener-cohorts-state--locked">
          <strong>Community matching is off</strong>
          <p>Enable community taste matching or city and scene community above to receive safe cohort suggestions.</p>
        </div>
      ) : null}

      {consentEnabled && loading && !suggestions ? (
        <div className="listener-cohorts-state">Loading listener cohorts...</div>
      ) : null}

      {consentEnabled && suggestions && cohorts.length === 0 ? (
        <div className="listener-cohorts-state">
          <strong>No cohort suggestions yet</strong>
          <p>Suggestions will appear here when enough opted-in listeners share a privacy-safe signal.</p>
        </div>
      ) : null}

      {consentEnabled && cohorts.length > 0 ? (
        <div className="listener-cohort-list" aria-label="Listener cohort suggestions">
          {cohorts.map((cohort) => (
            <ListenerCohortCard
              key={cohort.id}
              cohort={cohort}
              actionId={actionId}
              selected={cohort.id === selectedCohortId}
              onOpenDetail={onOpenDetail}
              onCloseDetail={onCloseDetail}
              onJoin={onJoin}
              onLeave={onLeave}
              onHide={onHide}
            />
          ))}
        </div>
      ) : null}

      {consentEnabled && selectedCohortId ? (
        <ListenerCohortDetailPanel
          panelRef={detailPanelRef}
          cohort={selectedCohort}
          detail={detail}
          cohortRoom={cohortRoom}
          loading={detailLoading}
          roomLoading={roomLoading}
          error={detailError}
          roomError={roomError}
          actionId={actionId}
          onClose={onCloseDetail}
          onLoadRoom={onLoadRoom}
          onJoinRoom={onJoinRoom}
          onJoin={onJoin}
          onLeave={onLeave}
          onHide={onHide}
        />
      ) : null}
    </div>
  );
}

function ListenerCohortCard({
  cohort,
  actionId,
  selected,
  onOpenDetail,
  onCloseDetail,
  onJoin,
  onLeave,
  onHide,
}: {
  cohort: CommunityCohort;
  actionId: string | null;
  selected: boolean;
  onOpenDetail: (cohort: CommunityCohort) => void;
  onCloseDetail: () => void;
  onJoin: (cohort: CommunityCohort) => void;
  onLeave: (cohort: CommunityCohort) => void;
  onHide: (cohort: CommunityCohort) => void;
}) {
  const primaryAction = cohortPrimaryAction(cohort);
  const cohortPending = actionId?.endsWith(`:${cohort.id}`) ?? false;
  const primaryPending = primaryAction ? actionId === `${primaryAction}:${cohort.id}` : false;
  const hidePending = actionId === `hide:${cohort.id}`;
  const isJoined = cohort.membership.status === "joined";

  return (
    <article className={`listener-cohort-card listener-cohort-card--${cohort.membership.status}${selected ? " listener-cohort-card--selected" : ""}`}>
      <div className="listener-cohort-card__body">
        <div className="listener-cohort-card__meta">
          <span>{cohortTypeLabel(cohort.cohortType)}</span>
          <span>{cohort.memberCountLabel}</span>
          <span className={`listener-cohort-card__status listener-cohort-card__status--${cohort.membership.status}`}>
            {cohortStatusLabel(cohort.membership.status)}
          </span>
        </div>
        <h4>{cohort.title}</h4>
        <p>{cohort.safeExplanation}</p>
        <div className="listener-cohort-card__reason">{cohortReasonLabel(cohort)}</div>
      </div>
      <div className="listener-cohort-card__actions">
        <Button
          variant="ghost"
          onClick={() => (selected ? onCloseDetail() : onOpenDetail(cohort))}
          disabled={cohortPending}
          aria-expanded={selected}
          aria-controls="listener-cohort-detail"
        >
          {selected ? "Hide details" : "Details"}
        </Button>
        {primaryAction === "join" ? (
          <Button onClick={() => onJoin(cohort)} disabled={cohortPending}>
            {primaryPending ? "Joining..." : cohort.membership.status === "left" ? "Rejoin" : "Join"}
          </Button>
        ) : null}
        {primaryAction === "leave" ? (
          <Button variant="ghost" onClick={() => onLeave(cohort)} disabled={cohortPending}>
            {primaryPending ? "Leaving..." : "Leave"}
          </Button>
        ) : null}
        {!isJoined && cohort.membership.status !== "hidden" ? (
          <Button variant="ghost" onClick={() => onHide(cohort)} disabled={cohortPending}>
            {hidePending ? "Hiding..." : "Hide"}
          </Button>
        ) : null}
      </div>
    </article>
  );
}

function ListenerCohortDetailPanel({
  panelRef,
  cohort,
  detail,
  cohortRoom,
  loading,
  roomLoading,
  error,
  roomError,
  actionId,
  onClose,
  onLoadRoom,
  onJoinRoom,
  onJoin,
  onLeave,
  onHide,
}: {
  panelRef: React.RefObject<HTMLElement | null>;
  cohort: CommunityCohort | null;
  detail: CommunityCohortDetailResponse | null;
  cohortRoom: CommunityCohortRoomResponse | null;
  loading: boolean;
  roomLoading: boolean;
  error: string | null;
  roomError: string | null;
  actionId: string | null;
  onClose: () => void;
  onLoadRoom: (cohort: CommunityCohort) => void;
  onJoinRoom: (cohort: CommunityCohort) => void;
  onJoin: (cohort: CommunityCohort) => void;
  onLeave: (cohort: CommunityCohort) => void;
  onHide: (cohort: CommunityCohort) => void;
}) {
  const primaryAction = cohort ? cohortPrimaryAction(cohort) : null;
  const cohortPending = cohort ? actionId?.endsWith(`:${cohort.id}`) ?? false : false;
  const primaryPending = cohort && primaryAction ? actionId === `${primaryAction}:${cohort.id}` : false;
  const hidePending = cohort ? actionId === `hide:${cohort.id}` : false;

  return (
    <aside
      ref={panelRef}
      id="listener-cohort-detail"
      className="listener-cohort-detail"
      role="region"
      aria-label="Listener cohort detail"
      aria-busy={loading}
      tabIndex={-1}
    >
      <div className="listener-cohort-detail__header">
        <div>
          <span className="settings-kicker">Cohort detail</span>
          <h4>{detail?.cohort.title ?? cohort?.title ?? "Listener cohort"}</h4>
          <p>{detail?.cohort.safeExplanation ?? "Loading privacy-safe cohort context..."}</p>
        </div>
        <Button variant="ghost" onClick={onClose}>Close</Button>
      </div>

      {loading ? (
        <div className="listener-cohorts-state">Loading cohort detail...</div>
      ) : null}

      {!loading && error ? (
        <div className="listener-cohorts-state listener-cohorts-state--locked">
          <strong>Cohort detail unavailable</strong>
          <p>{error}</p>
        </div>
      ) : null}

      {!loading && detail ? (
        <>
          <div className="listener-cohort-detail__summary">
            <div>
              <span>Type</span>
              <strong>{cohortTypeLabel(detail.cohort.cohortType)}</strong>
            </div>
            <div>
              <span>Signal</span>
              <strong>{detail.context.signalLabel}</strong>
            </div>
            <div>
              <span>Listeners</span>
              <strong>{detail.context.memberCountLabel}</strong>
            </div>
            <div>
              <span>Status</span>
              <strong>{cohortStatusLabel(detail.cohort.membership.status)}</strong>
            </div>
          </div>

          <div className="listener-cohort-detail__actions">
            <div>
              <span className="settings-kicker">Next actions</span>
              <h5>Use this signal</h5>
            </div>
            <div className="listener-cohort-detail__action-grid">
              {detail.actions.map((action) => {
                if (action.status !== "available") {
                  return (
                    <div
                      key={action.id}
                      className="listener-cohort-detail__action listener-cohort-detail__action--soon"
                      aria-disabled="true"
                    >
                      <strong>{action.label}</strong>
                      <span>{action.description}</span>
                      <span className="listener-cohort-detail__action-badge">Coming soon</span>
                    </div>
                  );
                }
                return (
                  <a key={action.id} href={action.href} className="listener-cohort-detail__action">
                    <strong>{action.label}</strong>
                    <span>{action.description}</span>
                  </a>
                );
              })}
            </div>
          </div>

          {cohort ? (
            <div className="listener-cohort-detail__membership">
              <span className="settings-kicker">Membership</span>
              <div className="listener-cohort-detail__membership-actions">
                {primaryAction === "join" ? (
                  <Button onClick={() => onJoin(cohort)} disabled={cohortPending}>
                    {primaryPending ? "Joining..." : cohort.membership.status === "left" ? "Rejoin" : "Join"}
                  </Button>
                ) : null}
                {primaryAction === "leave" ? (
                  <Button variant="ghost" onClick={() => onLeave(cohort)} disabled={cohortPending}>
                    {primaryPending ? "Leaving..." : "Leave"}
                  </Button>
                ) : null}
                {cohort.membership.status !== "joined" && cohort.membership.status !== "hidden" ? (
                  <Button variant="ghost" onClick={() => onHide(cohort)} disabled={cohortPending}>
                    {hidePending ? "Hiding..." : "Hide"}
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {cohort ? (
            <CohortRoomBlock
              cohort={cohort}
              cohortRoom={cohortRoom}
              loading={roomLoading}
              error={roomError}
              actionId={actionId}
              onLoadRoom={onLoadRoom}
              onJoinRoom={onJoinRoom}
            />
          ) : null}

          <div className="listener-cohort-detail__privacy">
            <span className="settings-kicker">Privacy boundary</span>
            <ul>
              {detail.redactions.map((redaction) => (
                <li key={redaction}>{redaction}</li>
              ))}
            </ul>
          </div>
        </>
      ) : null}
    </aside>
  );
}

function CohortRoomBlock({
  cohort,
  cohortRoom,
  loading,
  error,
  actionId,
  onLoadRoom,
  onJoinRoom,
}: {
  cohort: CommunityCohort;
  cohortRoom: CommunityCohortRoomResponse | null;
  loading: boolean;
  error: string | null;
  actionId: string | null;
  onLoadRoom: (cohort: CommunityCohort) => void;
  onJoinRoom: (cohort: CommunityCohort) => void;
}) {
  const isJoined = cohort.membership.status === "joined";
  const roomMembershipActive = cohortRoom?.room.membership?.status === "active";
  const roomPending = actionId === `join-room:${cohort.id}`;
  const [conversationOpen, setConversationOpen] = useState(false);

  return (
    <div className="listener-cohort-detail__room">
      <span className="settings-kicker">Cohort room</span>
      {!isJoined ? (
        <div className="listener-cohorts-state listener-cohorts-state--locked">
          <strong>Join required</strong>
          <p>Join this cohort before opening its private room.</p>
        </div>
      ) : null}
      {isJoined && loading ? (
        <div className="listener-cohorts-state">Loading cohort room...</div>
      ) : null}
      {isJoined && !loading && error ? (
        <div className="listener-cohorts-state listener-cohorts-state--locked">
          <strong>Cohort room unavailable</strong>
          <p>{error}</p>
          <Button variant="ghost" onClick={() => onLoadRoom(cohort)}>Retry</Button>
        </div>
      ) : null}
      {isJoined && !loading && !error && !cohortRoom ? (
        <div className="listener-cohorts-state">
          <strong>Cohort room not loaded</strong>
          <p>Load the privacy-safe room for joined members of this cohort.</p>
          <Button variant="ghost" onClick={() => onLoadRoom(cohort)}>Load room</Button>
        </div>
      ) : null}
      {isJoined && !loading && cohortRoom ? (
        <div className="listener-cohort-detail__room-card">
          <div className="listener-cohort-detail__room-info">
            <h5>{cohortRoom.room.title}</h5>
            <p>{roomMembershipActive ? cohortRoom.emptyState.description : "Join the room to post messages with this cohort."}</p>
            <div className="listener-cohort-detail__room-meta">
              <span>{cohortRoom.cohort.memberCountLabel}</span>
              <span>{cohortRoom.privacy.memberList === "not_exposed" ? "Member list hidden" : "Member list limited"}</span>
              <span>{cohortRoom.privacy.moderation === "community_moderation_queue" ? "Moderated" : "Moderation ready"}</span>
            </div>
          </div>
          {!roomMembershipActive ? (
            <Button onClick={() => onJoinRoom(cohort)} disabled={roomPending}>
              {roomPending ? "Joining room..." : "Join room"}
            </Button>
          ) : (
            <span className="listener-cohort-detail__room-status" role="status">
              <span aria-hidden="true">✓</span> Room ready
            </span>
          )}
        </div>
      ) : null}
      {isJoined && !loading && cohortRoom && roomMembershipActive ? (
        <>
          <Button
            variant="ghost"
            onClick={() => setConversationOpen((open) => !open)}
            aria-expanded={conversationOpen}
            aria-controls="cohort-room-conversation"
          >
            {conversationOpen ? "Hide conversation" : "Open conversation"}
          </Button>
          {conversationOpen ? (
            <div id="cohort-room-conversation">
              <CohortRoomConversation
                roomId={cohortRoom.room.id}
                roomActive={cohortRoom.room.status === "active"}
                emptyTitle={cohortRoom.emptyState.title}
                emptyDescription={cohortRoom.emptyState.description}
              />
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
