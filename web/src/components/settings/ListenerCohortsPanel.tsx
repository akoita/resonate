"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  type CommunityCohortMemberVisibility,
  type CommunityCohortRoomResponse,
  type CommunityCohortSuggestionsResponse,
  type CommunityVisibilitySettings,
} from "../../lib/api";
import { Button } from "../ui/Button";
import CohortRoomConversation from "../community/CohortRoomConversation";
import { roomAccessLockedReason } from "../community/roomAccess";
import {
  cohortBlurb,
  cohortCoverHues,
  cohortInitials,
  cohortKind,
  cohortKindCounts,
  cohortKindFilterLabel,
  cohortKindLabel,
  groupCohorts,
  type CohortKind,
} from "../community/cohortPresentation";
import { registerVisibleInterval } from "../../lib/visibleInterval";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

type CohortAction = "join" | "leave" | "hide";

const COHORT_REFRESH_MS = 5 * 60_000;

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

export function cohortStatusLabel(status: string) {
  const labels: Record<string, string> = {
    suggested: "Suggested",
    joined: "Joined",
    left: "Left",
    hidden: "Hidden",
  };
  return labels[status] ?? `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

function profileVisibilityLabel(visibility: string) {
  if (visibility === "public") return "Public";
  if (visibility === "community") return "Community";
  if (visibility === "followers") return "Followers";
  return "Private";
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

  const load = async ({ quiet = false }: { quiet?: boolean } = {}) => {
    if (!token) return;
    if (!quiet) setLoading(true);
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
      // A background refresh fails silently; the list on screen stays.
      if (quiet) return;
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
    if (!token) return undefined;
    // Keep the list current without a Refresh button: re-read every few
    // minutes while the tab is visible, and once when the listener returns.
    return registerVisibleInterval(() => void load({ quiet: true }), COHORT_REFRESH_MS);
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

/** Tiles shown per group before "Show all": two rows on a laptop. */
const COHORT_PREVIEW_COUNT = 8;

const KIND_ICONS: Record<CohortKind, ReactNode> = {
  taste: <span className="ms-icon" aria-hidden>graphic_eq</span>,
  artist_affinity: <span className="ms-icon" aria-hidden>mic</span>,
  city_scene: <span className="ms-icon" aria-hidden>location_on</span>,
  collector: <span className="ms-icon" aria-hidden>album</span>,
  campaign: <span className="ms-icon" aria-hidden>campaign</span>,
  other: <span className="ms-icon" aria-hidden>group</span>,
};

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
  const [kindFilter, setKindFilter] = useState<CohortKind | "all">("all");
  const kinds = useMemo(() => cohortKindCounts(cohorts), [cohorts]);
  // A filter whose last cohort went away falls back to everything.
  const activeFilter = kindFilter !== "all" && kinds.some((entry) => entry.kind === kindFilter) ? kindFilter : "all";
  const groups = useMemo(
    () => groupCohorts(activeFilter === "all" ? cohorts : cohorts.filter((cohort) => cohortKind(cohort.cohortType) === activeFilter)),
    [cohorts, activeFilter],
  );
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const detailOpen = consentEnabled && Boolean(selectedCohortId);

  // The detail is a modal side sheet (a bottom sheet on phones). `showModal`
  // gives focus containment, Escape, and the top layer; `closedby="any"` adds
  // a backdrop click where supported, with a click fallback for Safari.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    dialog.setAttribute("closedby", "any");
    if (detailOpen && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!detailOpen && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [detailOpen]);

  const handleDialogClick = (event: React.MouseEvent<HTMLDialogElement>) => {
    const dialog = dialogRef.current;
    if (!dialog || event.target !== dialog) return;
    if (typeof HTMLDialogElement !== "undefined" && "closedBy" in HTMLDialogElement.prototype) return;
    const rect = dialog.getBoundingClientRect();
    const inside = rect.top <= event.clientY && event.clientY <= rect.bottom
      && rect.left <= event.clientX && event.clientX <= rect.right;
    if (!inside) onCloseDetail();
  };

  const tileHandlers = { actionId, selectedCohortId, onOpenDetail, onCloseDetail, onJoin, onHide };

  return (
    <div className="cohorts">
      {!consentEnabled && !loading ? (
        <div className="listener-cohorts-state listener-cohorts-state--locked">
          <strong>Community matching is off</strong>
          <p>{roomAccessLockedReason("consent")}</p>
        </div>
      ) : null}

      {consentEnabled && loading && !suggestions ? (
        <div className="cohort-grid cohort-grid--loading" aria-busy="true">
          <span className="visually-hidden">Loading listener cohorts...</span>
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="cohort-tile cohort-tile--skeleton" aria-hidden>
              <span className="cohort-tile__art" />
              <span className="cohort-tile__skeleton-line" />
              <span className="cohort-tile__skeleton-line cohort-tile__skeleton-line--short" />
            </div>
          ))}
        </div>
      ) : null}

      {consentEnabled && suggestions && cohorts.length === 0 ? (
        <div className="listener-cohorts-state">
          <strong>No cohort suggestions yet</strong>
          <p>Suggestions will appear here when enough opted-in listeners share a privacy-safe signal.</p>
        </div>
      ) : null}

      {consentEnabled && cohorts.length > 0 ? (
        <>
          {kinds.length > 1 ? (
            <div className="cohort-filters" role="group" aria-label="Show communities by kind">
              <button
                type="button"
                className="cohort-filter"
                aria-pressed={activeFilter === "all"}
                onClick={() => setKindFilter("all")}
              >
                All <span className="cohort-filter__count">{cohorts.length}</span>
              </button>
              {kinds.map(({ kind, count }) => (
                <button
                  key={kind}
                  type="button"
                  className="cohort-filter"
                  aria-pressed={activeFilter === kind}
                  onClick={() => setKindFilter(kind)}
                >
                  {KIND_ICONS[kind]}
                  {cohortKindFilterLabel(kind)} <span className="cohort-filter__count">{count}</span>
                </button>
              ))}
            </div>
          ) : null}

          <div className="listener-cohort-list" aria-label="Listener cohort suggestions">
            {groups.joined.length > 0 ? (
              <CohortGroup
                id="cohorts-joined"
                title="Joined"
                hint="Open one to see who is there and talk in its room."
                cohorts={groups.joined}
                resetKey={activeFilter}
                {...tileHandlers}
              />
            ) : null}
            {groups.suggested.length > 0 ? (
              <CohortGroup
                id="cohorts-suggested"
                title="Suggested for you"
                hint="Based on what you play. Nobody sees you here until you join."
                cohorts={groups.suggested}
                resetKey={activeFilter}
                {...tileHandlers}
              />
            ) : null}
          </div>
        </>
      ) : null}

      <dialog
        ref={dialogRef}
        id="listener-cohort-detail"
        className="cohort-sheet"
        aria-label="Listener cohort detail"
        onClose={() => {
          if (selectedCohortId) onCloseDetail();
        }}
        onClick={handleDialogClick}
      >
        {detailOpen ? (
          <ListenerCohortDetailPanel
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
      </dialog>
    </div>
  );
}

type CohortTileHandlers = {
  actionId: string | null;
  selectedCohortId: string | null;
  onOpenDetail: (cohort: CommunityCohort) => void;
  onCloseDetail: () => void;
  onJoin: (cohort: CommunityCohort) => void;
  onHide: (cohort: CommunityCohort) => void;
};

function CohortGroup({
  id,
  title,
  hint,
  cohorts,
  resetKey,
  ...handlers
}: CohortTileHandlers & {
  id: string;
  title: string;
  hint: string;
  cohorts: CommunityCohort[];
  resetKey: string;
}) {
  const [expandedFor, setExpandedFor] = useState<string | null>(null);
  const expanded = expandedFor === resetKey;
  const overflow = cohorts.length > COHORT_PREVIEW_COUNT;
  const shown = expanded || !overflow ? cohorts : cohorts.slice(0, COHORT_PREVIEW_COUNT);

  return (
    <section className="cohort-group" aria-labelledby={`${id}-title`}>
      <header className="cohort-group__header">
        <h3 id={`${id}-title`}>
          {title}
          <span className="cohort-group__count">{cohorts.length}</span>
        </h3>
        <p>{hint}</p>
      </header>
      <ul className="cohort-grid" id={`${id}-grid`}>
        {shown.map((cohort) => (
          <li key={cohort.id}>
            <ListenerCohortCard
              cohort={cohort}
              selected={cohort.id === handlers.selectedCohortId}
              {...handlers}
            />
          </li>
        ))}
      </ul>
      {overflow ? (
        <button
          type="button"
          className="cohort-group__more"
          aria-expanded={expanded}
          aria-controls={`${id}-grid`}
          onClick={() => setExpandedFor(expanded ? null : resetKey)}
        >
          {expanded ? "Show fewer" : `Show all ${cohorts.length}`}
          <span className="ms-icon" aria-hidden>expand_more</span>
        </button>
      ) : null}
    </section>
  );
}

function CohortCover({ cohort }: { cohort: CommunityCohort }) {
  const kind = cohortKind(cohort.cohortType);
  const { base, accent } = cohortCoverHues(`${cohort.cohortType}:${cohort.title}`);
  return (
    <span
      className={`cohort-cover cohort-cover--${kind}`}
      style={{ "--cover-h1": base, "--cover-h2": accent } as React.CSSProperties}
      aria-hidden
    >
      <span className="cohort-cover__rings" />
      <span className="cohort-cover__glyph">{KIND_ICONS[kind]}</span>
      <span className="cohort-cover__initials">{cohortInitials(cohort.title)}</span>
    </span>
  );
}

function ListenerCohortCard({
  cohort,
  actionId,
  selected,
  onOpenDetail,
  onCloseDetail,
  onJoin,
  onHide,
}: Omit<CohortTileHandlers, "selectedCohortId"> & {
  cohort: CommunityCohort;
  selected: boolean;
}) {
  const kind = cohortKind(cohort.cohortType);
  const status = cohort.membership.status;
  const primaryAction = cohortPrimaryAction(cohort);
  const cohortPending = actionId?.endsWith(`:${cohort.id}`) ?? false;
  const joinPending = actionId === `join:${cohort.id}`;
  const hidePending = actionId === `hide:${cohort.id}`;
  const toggleDetail = () => (selected ? onCloseDetail() : onOpenDetail(cohort));

  return (
    <article
      className={`cohort-tile listener-cohort-card--${status}${selected ? " is-selected" : ""}`}
      aria-busy={cohortPending}
    >
      <div className="cohort-tile__art">
        <button
          type="button"
          className="cohort-tile__open"
          onClick={toggleDetail}
          aria-expanded={selected}
          aria-controls="listener-cohort-detail"
          aria-label={`${selected ? "Hide details" : "Details"}: ${cohort.title}`}
        >
          <CohortCover cohort={cohort} />
        </button>
        <span className="cohort-tile__kind">{cohortKindLabel(kind)}</span>
        {status === "joined" || status === "left" ? (
          <span className={`cohort-tile__status listener-cohort-card__status--${status}`}>
            {status === "joined" ? <span className="ms-icon" aria-hidden>check</span> : null}
            {cohortStatusLabel(status)}
          </span>
        ) : null}
      </div>

      <div className="cohort-tile__body">
        <h4 className="cohort-tile__title">
          <button type="button" onClick={toggleDetail} tabIndex={-1}>
            {cohort.title}
          </button>
        </h4>
        <p className="cohort-tile__blurb">{cohortBlurb(cohort)}</p>
        <p className="cohort-tile__meta">
          <span className="ms-icon" aria-hidden>group</span>
          {cohort.memberCountLabel}
        </p>
      </div>

      <div className="cohort-tile__actions">
        {primaryAction === "join" ? (
          <Button className="ui-btn-sm" onClick={() => onJoin(cohort)} disabled={cohortPending}>
            {joinPending ? null : <span className="ms-icon" aria-hidden>add</span>}
            {joinPending ? "Joining..." : status === "left" ? "Rejoin" : "Join"}
          </Button>
        ) : (
          <Button variant="ghost" className="ui-btn-sm" onClick={toggleDetail} disabled={cohortPending}>
            <span className="ms-icon" aria-hidden>forum</span>
            Open
          </Button>
        )}
        {status !== "joined" ? (
          <button
            type="button"
            className="cohort-tile__icon-btn"
            onClick={() => onHide(cohort)}
            disabled={cohortPending}
            aria-label={hidePending ? `Hiding ${cohort.title}` : `Hide ${cohort.title}`}
            title="Not for me"
          >
            <span className="ms-icon" aria-hidden>visibility_off</span>
          </button>
        ) : null}
      </div>
    </article>
  );
}

function ListenerCohortDetailPanel({
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
    <div className="listener-cohort-detail" aria-busy={loading}>
      <div className="listener-cohort-detail__header">
        {cohort ? (
          <span className="listener-cohort-detail__cover">
            <CohortCover cohort={cohort} />
          </span>
        ) : null}
        <div>
          <span className="settings-kicker">Cohort detail</span>
          <h4>{detail?.cohort.title ?? cohort?.title ?? "Listener cohort"}</h4>
          <p>{detail?.cohort.safeExplanation ?? "Loading privacy-safe cohort context..."}</p>
        </div>
        <button type="button" className="cohort-sheet__close" onClick={onClose} aria-label="Close">
          <span className="ms-icon" aria-hidden>close</span>
        </button>
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

          {detail.memberVisibility ? (
            <CohortMemberVisibilityBlock memberVisibility={detail.memberVisibility} />
          ) : null}

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
    </div>
  );
}

function CohortMemberVisibilityBlock({
  memberVisibility,
}: {
  memberVisibility: CommunityCohortMemberVisibility;
}) {
  const visibleMembers = memberVisibility.visibleMembers;
  return (
    <section className="listener-cohort-detail__members" aria-label="Visible cohort members">
      <div className="listener-cohort-detail__members-header">
        <div>
          <span className="settings-kicker">Member visibility</span>
          <h5>{memberVisibility.memberListLabel}</h5>
        </div>
        <span className={`listener-cohort-detail__viewer-state ${memberVisibility.currentViewer.canAppear ? "is-visible" : ""}`}>
          {memberVisibility.currentViewer.canAppear ? "You can appear" : "You are hidden"}
        </span>
      </div>

      <p className="listener-cohort-detail__viewer-copy">{memberVisibility.currentViewer.reason}</p>

      {visibleMembers.length > 0 ? (
        <div className="listener-cohort-detail__member-grid">
          {visibleMembers.map((member) => {
            const memberContent = (
              <>
                <span
                  className={`listener-cohort-detail__member-avatar ${member.avatarUrl ? "has-image" : ""}`}
                  style={member.avatarUrl ? { backgroundImage: `url("${member.avatarUrl}")` } : undefined}
                  aria-hidden
                >
                  {!member.avatarUrl ? (
                    <span>{member.displayName.trim().charAt(0).toUpperCase() || "R"}</span>
                  ) : null}
                </span>
                <span className="listener-cohort-detail__member-copy">
                  <strong>{member.displayName}</strong>
                  <small>{profileVisibilityLabel(member.profileVisibility)} profile</small>
                </span>
              </>
            );
            if (member.profileHref) {
              return (
                <a key={member.memberKey} href={member.profileHref} className="listener-cohort-detail__member">
                  {memberContent}
                </a>
              );
            }
            return (
              <div key={member.memberKey} className="listener-cohort-detail__member">
                {memberContent}
              </div>
            );
          })}
        </div>
      ) : (
        <div className="listener-cohorts-state">
          <strong>Nobody has opted in to appear yet</strong>
          <p>{memberVisibility.anonymousMemberLabel}</p>
        </div>
      )}

      {visibleMembers.length > 0 ? (
        <p className="listener-cohort-detail__anonymous-copy">{memberVisibility.anonymousMemberLabel}</p>
      ) : null}
    </section>
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
