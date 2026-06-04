"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  getCommunityCohortDetail,
  getCommunityCohortSuggestions,
  getMyCommunityProfile,
  hideCommunityCohort,
  joinCommunityCohort,
  leaveCommunityCohort,
  type CommunityCohort,
  type CommunityCohortDetailResponse,
  type CommunityCohortSuggestionsResponse,
  type CommunityVisibilitySettings,
} from "../../lib/api";
import { Button } from "../ui/Button";

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
  loading: boolean;
  detailLoading: boolean;
  detailError: string | null;
  consentEnabled: boolean;
  actionId: string | null;
  onRefresh: () => void;
  onOpenDetail: (cohort: CommunityCohort) => void;
  onCloseDetail: () => void;
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
  const [loading, setLoading] = useState(false);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [actionId, setActionId] = useState<string | null>(null);
  const selectedCohortIdRef = useRef<string | null>(null);
  const detailRequestIdRef = useRef(0);

  const clearDetailSelection = () => {
    detailRequestIdRef.current += 1;
    selectedCohortIdRef.current = null;
    setSelectedCohortId(null);
    setDetail(null);
    setDetailError(null);
    setDetailLoading(false);
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
    selectedCohortIdRef.current = cohortId;
    setSelectedCohortId(cohortId);
    setDetail(null);
    setDetailLoading(true);
    setDetailError(null);
    try {
      const response = await getCommunityCohortDetail(token, cohortId);
      if (detailRequestIdRef.current !== requestId) return;
      setDetail(response);
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

  const consentEnabled = Boolean(visibility?.allowTasteMatching || visibility?.allowCityScenes);

  return (
    <ListenerCohortsContent
      suggestions={suggestions}
      selectedCohortId={selectedCohortId}
      detail={detail}
      loading={loading}
      detailLoading={detailLoading}
      detailError={detailError}
      consentEnabled={consentEnabled}
      actionId={actionId}
      onRefresh={load}
      onOpenDetail={(cohort) => void loadDetail(cohort.id)}
      onCloseDetail={clearDetailSelection}
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
  loading,
  detailLoading,
  detailError,
  consentEnabled,
  actionId,
  onRefresh,
  onOpenDetail,
  onCloseDetail,
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
              onJoin={onJoin}
              onLeave={onLeave}
              onHide={onHide}
            />
          ))}
        </div>
      ) : null}

      {consentEnabled && selectedCohortId ? (
        <ListenerCohortDetailPanel
          cohort={selectedCohort}
          detail={detail}
          loading={detailLoading}
          error={detailError}
          actionId={actionId}
          onClose={onCloseDetail}
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
  onJoin,
  onLeave,
  onHide,
}: {
  cohort: CommunityCohort;
  actionId: string | null;
  selected: boolean;
  onOpenDetail: (cohort: CommunityCohort) => void;
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
          <span>{cohort.membership.status}</span>
        </div>
        <h4>{cohort.title}</h4>
        <p>{cohort.safeExplanation}</p>
        <div className="listener-cohort-card__reason">{cohortReasonLabel(cohort)}</div>
      </div>
      <div className="listener-cohort-card__actions">
        <Button variant="ghost" onClick={() => onOpenDetail(cohort)} disabled={cohortPending}>
          {selected ? "Viewing" : "Details"}
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
  cohort,
  detail,
  loading,
  error,
  actionId,
  onClose,
  onJoin,
  onLeave,
  onHide,
}: {
  cohort: CommunityCohort | null;
  detail: CommunityCohortDetailResponse | null;
  loading: boolean;
  error: string | null;
  actionId: string | null;
  onClose: () => void;
  onJoin: (cohort: CommunityCohort) => void;
  onLeave: (cohort: CommunityCohort) => void;
  onHide: (cohort: CommunityCohort) => void;
}) {
  const primaryAction = cohort ? cohortPrimaryAction(cohort) : null;
  const cohortPending = cohort ? actionId?.endsWith(`:${cohort.id}`) ?? false : false;
  const primaryPending = cohort && primaryAction ? actionId === `${primaryAction}:${cohort.id}` : false;
  const hidePending = cohort ? actionId === `hide:${cohort.id}` : false;

  return (
    <aside className="listener-cohort-detail" aria-label="Listener cohort detail">
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
              <strong>{detail.cohort.membership.status}</strong>
            </div>
          </div>

          <div className="listener-cohort-detail__actions">
            <div>
              <span className="settings-kicker">Next actions</span>
              <h5>Use this signal</h5>
            </div>
            <div className="listener-cohort-detail__action-grid">
              {detail.actions.map((action) => (
                <a key={action.id} href={action.href} className="listener-cohort-detail__action">
                  <strong>{action.label}</strong>
                  <span>{action.description}</span>
                </a>
              ))}
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
