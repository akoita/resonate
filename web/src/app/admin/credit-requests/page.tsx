"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { useToast } from "../../../components/ui/Toast";
import {
  ApiRequestError,
  dismissCreditRequest,
  getCreditRequests,
  getCreditsBalance,
  grantCreditRequest,
  type CreditRequest,
} from "../../../lib/api";
import { formatUsdCents, parseDollarsToCents } from "./amount";
import CreditRequestsQueueView, {
  draftReason,
  reviewerIsRequester,
  shortenId,
  type CreditRequestAction,
  type CreditRequestDraft,
  type CreditRequestsQueueState,
  type CreditRequestsTab,
  type PendingDismissal,
  type PendingGrant,
} from "./QueueView";

type ScopedValue<T> = { scope: symbol | null; value: T };
type InFlight = { requestId: string; action: CreditRequestAction };
/** Queue state tagged with the tab it was loaded for, so a tab switch never shows the other tab's rows. */
type TabQueueState = { tab: CreditRequestsTab | null; state: CreditRequestsQueueState };

const ALREADY_HANDLED = "Already handled by another operator.";
const SELF_REVIEW_FORBIDDEN = "You can't resolve your own credit request.";
const EMPTY_RECORD: Record<string, never> = {};
const LOADING_STATE: CreditRequestsQueueState = { status: "loading" };
const INITIAL_QUEUE: TabQueueState = { tab: null, state: LOADING_STATE };

/**
 * State bound to the signed-in session: a value written under one session is
 * never shown to the next one (e.g. after an account switch).
 */
function useScopedState<T>(scope: symbol | null, fallback: T) {
  const [snapshot, setSnapshot] = useState<ScopedValue<T>>({ scope: null, value: fallback });
  const value = scope && snapshot.scope === scope ? snapshot.value : fallback;
  const update = useCallback((next: T | ((current: T) => T)) => {
    setSnapshot((previous) => {
      const current = scope && previous.scope === scope ? previous.value : fallback;
      return {
        scope,
        value: typeof next === "function" ? (next as (current: T) => T)(current) : next,
      };
    });
  }, [fallback, scope]);
  return [value, update] as const;
}

function isConflict(reason: unknown) {
  return reason instanceof ApiRequestError && reason.status === 409;
}

function isSelfReviewForbidden(reason: unknown) {
  if (!(reason instanceof ApiRequestError) || reason.status !== 403) return false;
  const details = reason.details;
  return typeof details === "object"
    && details !== null
    && (details as { code?: unknown }).code === "self_review_forbidden";
}

export default function CreditRequestsAdminPage() {
  const { token, role, userId } = useAuth();
  const sessionScope = useMemo(
    () => token ? Symbol(userId ?? role ?? "credit-requests-session") : null,
    [role, token, userId],
  );
  const { addToast } = useToast();
  const canReview = role === "admin" || role === "operator";

  const [tab, setTab] = useState<CreditRequestsTab>("pending");
  const [queue, setQueue] = useScopedState<TabQueueState>(sessionScope, INITIAL_QUEUE);
  const [priceCentsPer30s, setPriceCentsPer30s] = useScopedState<number | null>(sessionScope, null);
  const [drafts, setDrafts] = useScopedState<Record<string, CreditRequestDraft>>(sessionScope, EMPTY_RECORD);
  const [errors, setErrors] = useScopedState<Record<string, string>>(sessionScope, EMPTY_RECORD);
  const [inFlight, setInFlight] = useScopedState<InFlight | null>(sessionScope, null);
  const [pendingGrant, setPendingGrant] = useScopedState<PendingGrant | null>(sessionScope, null);
  const [pendingDismissal, setPendingDismissal] = useScopedState<PendingDismissal | null>(sessionScope, null);
  const [successMessage, setSuccessMessage] = useScopedState<string | null>(sessionScope, null);

  const loadSequenceRef = useRef(0);
  const currentScopeRef = useRef(sessionScope);
  useLayoutEffect(() => {
    currentScopeRef.current = sessionScope;
    return () => { currentScopeRef.current = null; };
  }, [sessionScope]);

  const visibleState: CreditRequestsQueueState = !canReview
    ? { status: "forbidden" }
    : token && sessionScope && queue.tab === tab ? queue.state : LOADING_STATE;

  const setError = useCallback((requestId: string, message: string) => {
    setErrors((previous) => ({ ...previous, [requestId]: message }));
  }, [setErrors]);

  /**
   * Load the active tab. A background refresh keeps the current rows on screen
   * instead of flashing the loading skeleton (used after a grant/dismiss).
   */
  const load = useCallback(async (options: { background?: boolean; keepSuccess?: boolean } = {}) => {
    const requestScope = sessionScope;
    if (!token || !requestScope || currentScopeRef.current !== requestScope || !canReview) return;
    const requestSequence = ++loadSequenceRef.current;
    if (!options.background) setQueue({ tab, state: LOADING_STATE });
    if (!options.keepSuccess) setSuccessMessage(null);
    try {
      const requests = await getCreditRequests(token, tab);
      if (currentScopeRef.current === requestScope && requestSequence === loadSequenceRef.current) {
        setQueue({ tab, state: { status: "ready", requests } });
      }
    } catch (reason) {
      if (currentScopeRef.current === requestScope && requestSequence === loadSequenceRef.current) {
        setQueue({
          tab,
          state: {
            status: "error",
            message: reason instanceof Error ? reason.message : "Unable to load credit requests.",
          },
        });
      }
    }
  }, [canReview, sessionScope, setQueue, setSuccessMessage, tab, token]);

  useEffect(() => {
    if (!token || !sessionScope) {
      ++loadSequenceRef.current;
      return;
    }
    void load();
  }, [load, sessionScope, token]);

  // The per-30s generation price turns balances into minutes of generation.
  // Optional: without it the queue shows dollar balances only.
  useEffect(() => {
    if (!token || !sessionScope || !canReview) return;
    const requestScope = sessionScope;
    getCreditsBalance(token)
      .then((balance) => {
        if (currentScopeRef.current === requestScope) setPriceCentsPer30s(balance.priceCentsPer30s);
      })
      .catch(() => {
        // Capacity is a convenience; dollar balances still render.
      });
  }, [canReview, sessionScope, setPriceCentsPer30s, token]);

  const removeRequest = (requestId: string) => {
    setQueue((current) => current.state.status === "ready"
      ? {
        tab: current.tab,
        state: { status: "ready", requests: current.state.requests.filter((request) => request.id !== requestId) },
      }
      : current);
    setDrafts((previous) => {
      const next = { ...previous };
      delete next[requestId];
      return next;
    });
    setError(requestId, "");
  };

  const handleConflict = (request: CreditRequest) => {
    removeRequest(request.id);
    addToast({ type: "warning", title: ALREADY_HANDLED, message: "The queue has been refreshed." });
    void load({ background: true });
  };

  const canAct = (request: CreditRequest) => Boolean(
    token
    && sessionScope
    && currentScopeRef.current === sessionScope
    && canReview
    && !inFlight
    && !reviewerIsRequester(userId, request.userId),
  );

  /** Shared failure handling for grant and dismiss. */
  const handleActionError = (request: CreditRequest, reason: unknown, title: string, fallback: string) => {
    if (isConflict(reason)) {
      handleConflict(request);
      return;
    }
    if (isSelfReviewForbidden(reason)) {
      setError(request.id, SELF_REVIEW_FORBIDDEN);
      addToast({ type: "error", title: SELF_REVIEW_FORBIDDEN, message: "Another operator has to resolve it." });
      return;
    }
    const message = reason instanceof Error ? reason.message : fallback;
    setError(request.id, message);
    addToast({ type: "error", title, message });
  };

  const requestQuickGrant = (request: CreditRequest, amountCents: number) => {
    if (!canAct(request)) return;
    setError(request.id, "");
    setPendingGrant({ request, amountCents, reason: draftReason(drafts[request.id]) });
  };

  const requestCustomGrant = (request: CreditRequest) => {
    if (!canAct(request)) return;
    const parsed = parseDollarsToCents(drafts[request.id]?.amount ?? "");
    if (!parsed.ok) {
      setError(request.id, parsed.error);
      return;
    }
    setError(request.id, "");
    setPendingGrant({ request, amountCents: parsed.cents, reason: draftReason(drafts[request.id]) });
  };

  const requestDismiss = (request: CreditRequest) => {
    if (!canAct(request)) return;
    setError(request.id, "");
    setPendingDismissal({ request, note: drafts[request.id]?.dismissNote ?? "" });
  };

  const confirmGrant = async () => {
    const grant = pendingGrant;
    const requestScope = sessionScope;
    if (!grant || !token || !requestScope || currentScopeRef.current !== requestScope || inFlight) return;
    const { request, amountCents, reason } = grant;
    setInFlight({ requestId: request.id, action: "grant" });
    try {
      await grantCreditRequest(token, request.id, { amountCents, reason });
      if (currentScopeRef.current !== requestScope) return;
      setPendingGrant(null);
      removeRequest(request.id);
      const message = `Granted ${formatUsdCents(amountCents)} of generation credits to ${shortenId(request.userId)}.`;
      setSuccessMessage(message);
      addToast({ type: "success", title: "Credits granted", message });
      void load({ background: true, keepSuccess: true });
    } catch (reason) {
      if (currentScopeRef.current !== requestScope) return;
      setPendingGrant(null);
      handleActionError(request, reason, "Grant failed", "Unable to grant credits.");
    } finally {
      if (currentScopeRef.current === requestScope) setInFlight(null);
    }
  };

  const confirmDismiss = async () => {
    const dismissal = pendingDismissal;
    const requestScope = sessionScope;
    if (!dismissal || !token || !requestScope || currentScopeRef.current !== requestScope || inFlight) return;
    const { request, note } = dismissal;
    setInFlight({ requestId: request.id, action: "dismiss" });
    try {
      await dismissCreditRequest(token, request.id, { note });
      if (currentScopeRef.current !== requestScope) return;
      setPendingDismissal(null);
      removeRequest(request.id);
      const message = `Dismissed the credit request from ${shortenId(request.userId)}.`;
      setSuccessMessage(message);
      addToast({ type: "success", title: "Request dismissed", message });
      void load({ background: true, keepSuccess: true });
    } catch (reason) {
      if (currentScopeRef.current !== requestScope) return;
      setPendingDismissal(null);
      handleActionError(request, reason, "Dismiss failed", "Unable to dismiss the request.");
    } finally {
      if (currentScopeRef.current === requestScope) setInFlight(null);
    }
  };

  return (
    <AuthGate title="Sign in with an operator account to review credit requests.">
      <CreditRequestsQueueView
        tab={tab}
        state={visibleState}
        reviewerUserId={userId}
        priceCentsPer30s={priceCentsPer30s}
        drafts={drafts}
        errors={errors}
        inFlight={inFlight}
        pendingGrant={pendingGrant}
        pendingDismissal={pendingDismissal}
        successMessage={successMessage}
        onTabChange={(next) => {
          if (next === tab) return;
          setSuccessMessage(null);
          setTab(next);
        }}
        onRetry={() => void load()}
        onDraftChange={(requestId, field, value) => {
          setDrafts((previous) => ({ ...previous, [requestId]: { ...previous[requestId], [field]: value } }));
          setError(requestId, "");
        }}
        onQuickGrant={requestQuickGrant}
        onRequestGrant={requestCustomGrant}
        onRequestDismiss={requestDismiss}
        onCancelGrant={() => setPendingGrant(null)}
        onConfirmGrant={confirmGrant}
        onCancelDismiss={() => setPendingDismissal(null)}
        onConfirmDismiss={confirmDismiss}
      />
    </AuthGate>
  );
}
