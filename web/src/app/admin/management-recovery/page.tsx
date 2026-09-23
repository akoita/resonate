"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { ConfirmDialog } from "../../../components/ui/ConfirmDialog";
import { useToast } from "../../../components/ui/Toast";
import {
  getPendingManagementRecoveries,
  reviewManagementRecovery,
  type ManagementRecoveryDecision,
  type ManagementRecoveryRequest,
  type PendingManagementRecoveriesResponse,
} from "../../../lib/api";

type LoadState =
  | { status: "loading" }
  | { status: "ready"; data: PendingManagementRecoveriesResponse }
  | { status: "forbidden" }
  | { status: "error"; message: string };

export default function ManagementRecoveryAdminPage() {
  const { token, role, userId } = useAuth();
  const sessionScope = useMemo(() => token ? Symbol(userId ?? role ?? "management-recovery-session") : null, [role, token, userId]);
  const { addToast } = useToast();
  const [stateSnapshot, setStateSnapshot] = useState<{ scope: symbol | null; state: LoadState }>({
    scope: null,
    state: { status: "loading" },
  });
  const [reviewNotesSnapshot, setReviewNotesSnapshot] = useState<{ scope: symbol | null; values: Record<string, string> }>({ scope: null, values: {} });
  const [reviewErrorsSnapshot, setReviewErrorsSnapshot] = useState<{ scope: symbol | null; values: Record<string, string> }>({ scope: null, values: {} });
  const [reviewingSnapshot, setReviewingSnapshot] = useState<{ scope: symbol | null; requestId: string | null }>({ scope: null, requestId: null });
  const [approvalSnapshot, setApprovalSnapshot] = useState<{ scope: symbol | null; request: ManagementRecoveryRequest | null }>({ scope: null, request: null });
  const loadSequenceRef = useRef(0);
  const currentScopeRef = useRef(sessionScope);
  useLayoutEffect(() => {
    currentScopeRef.current = sessionScope;
    return () => { currentScopeRef.current = null; };
  }, [sessionScope]);
  const canReview = role === "admin" || role === "operator";
  const visibleState: LoadState = !canReview
    ? { status: "forbidden" }
    : token && sessionScope && stateSnapshot.scope === sessionScope
      ? stateSnapshot.state
      : { status: "loading" };
  const reviewNotes = sessionScope && reviewNotesSnapshot.scope === sessionScope ? reviewNotesSnapshot.values : {};
  const reviewErrors = sessionScope && reviewErrorsSnapshot.scope === sessionScope ? reviewErrorsSnapshot.values : {};
  const reviewingRequestId = sessionScope && reviewingSnapshot.scope === sessionScope ? reviewingSnapshot.requestId : null;
  const pendingApproval = sessionScope && approvalSnapshot.scope === sessionScope ? approvalSnapshot.request : null;
  const updateReviewNotes = (update: React.SetStateAction<Record<string, string>>) => {
    setReviewNotesSnapshot((previous) => {
      const current = sessionScope && previous.scope === sessionScope ? previous.values : {};
      return { scope: sessionScope, values: typeof update === "function" ? update(current) : update };
    });
  };
  const updateReviewErrors = (update: React.SetStateAction<Record<string, string>>) => {
    setReviewErrorsSnapshot((previous) => {
      const current = sessionScope && previous.scope === sessionScope ? previous.values : {};
      return { scope: sessionScope, values: typeof update === "function" ? update(current) : update };
    });
  };

  const load = useCallback(async () => {
    const requestScope = sessionScope;
    if (!token || !requestScope || currentScopeRef.current !== requestScope) return;
    const requestSequence = ++loadSequenceRef.current;
    if (!canReview) {
      setStateSnapshot({ scope: requestScope, state: { status: "forbidden" } });
      return;
    }
    setStateSnapshot({ scope: requestScope, state: { status: "loading" } });
    try {
      const data = await getPendingManagementRecoveries(token);
      if (currentScopeRef.current === requestScope && requestSequence === loadSequenceRef.current) {
        setStateSnapshot({ scope: requestScope, state: { status: "ready", data } });
      }
    } catch (reason) {
      if (currentScopeRef.current === requestScope && requestSequence === loadSequenceRef.current) {
        setStateSnapshot({
          scope: requestScope,
          state: {
            status: "error",
            message: reason instanceof Error ? reason.message : "Unable to load management recovery requests.",
          },
        });
      }
    }
  }, [canReview, sessionScope, token]);

  useEffect(() => {
    if (!token || !sessionScope) {
      ++loadSequenceRef.current;
      return;
    }
    void load();
  }, [load, sessionScope, token]);

  const review = async (requestId: string, decision: ManagementRecoveryDecision) => {
    const requestScope = sessionScope;
    if (!token || !requestScope || currentScopeRef.current !== requestScope || !canReview || reviewingRequestId) return;
    const note = (reviewNotes[requestId] ?? "").trim();
    if (!note) {
      updateReviewErrors((previous) => ({ ...previous, [requestId]: "Add a review note before recording a decision." }));
      return;
    }

    setReviewingSnapshot({ scope: requestScope, requestId });
    updateReviewErrors((previous) => ({ ...previous, [requestId]: "" }));
    try {
      await reviewManagementRecovery(token, requestId, { decision, note });
      if (currentScopeRef.current !== requestScope) return;
      updateReviewNotes((previous) => ({ ...previous, [requestId]: "" }));
      if (decision === "approve") setApprovalSnapshot({ scope: requestScope, request: null });
      addToast({
        type: "success",
        title: decision === "approve" ? "Recovery approved" : "Recovery rejected",
        message: "The review decision was recorded.",
      });
      await load();
    } catch (reason) {
      if (currentScopeRef.current !== requestScope) return;
      const message = reason instanceof Error ? reason.message : "Unable to record the review decision.";
      updateReviewErrors((previous) => ({ ...previous, [requestId]: message }));
      if (decision === "approve") setApprovalSnapshot({ scope: requestScope, request: null });
      addToast({ type: "error", title: "Review decision failed", message });
    } finally {
      if (currentScopeRef.current === requestScope) setReviewingSnapshot({ scope: requestScope, requestId: null });
    }
  };

  const requestApproval = (request: ManagementRecoveryRequest) => {
    if (!sessionScope || currentScopeRef.current !== sessionScope) return;
    if (!(reviewNotes[request.id] ?? "").trim()) {
      updateReviewErrors((previous) => ({ ...previous, [request.id]: "Add a review note before recording a decision." }));
      return;
    }
    setApprovalSnapshot({ scope: sessionScope, request });
  };

  const approvalMessage = pendingApproval
    ? `Resources affected:\n${pendingApproval.resources.map((resource) => `• ${resource.name}`).join("\n")}\n\nApproving will restore the original proposer’s management authority. The current manager will be displaced and their management grants revoked. Credits, rights, and payouts will not change.`
    : "";

  return (
    <AuthGate title="Sign in with an operator account to review management recovery requests.">
      <main className="analytics-container management-recovery-admin" style={{ padding: "12px 0 64px" }}>
        <header className="analytics-header-section">
          <p className="artist-analytics-eyebrow">Operator review</p>
          <h1>Management transfer recovery</h1>
          <p className="analytics-muted">
            Review the evidence before approving or rejecting a recovery request. Submitting a request does not reverse management access automatically. These decisions do not move credits, rights, or payouts.
          </p>
        </header>

        {visibleState.status === "loading" && <p role="status">Loading pending requests…</p>}
        {visibleState.status === "forbidden" && <section className="glass-panel recovery-state" role="alert">
          <h2>Access denied</h2>
          <p className="analytics-muted">Only operators and administrators can review management recovery requests.</p>
        </section>}
        {visibleState.status === "error" && <section className="glass-panel recovery-state" role="alert">
          <h2>Unable to load the review queue</h2>
          <p className="analytics-muted">{visibleState.message}</p>
          <button type="button" onClick={() => void load()}>Try again</button>
        </section>}
        {visibleState.status === "ready" && visibleState.data.requests.length === 0 && <section className="glass-panel recovery-state">
          <h2>No pending requests</h2>
          <p className="analytics-muted">New management recovery requests will appear here for review.</p>
          <button type="button" onClick={() => void load()}>Refresh queue</button>
        </section>}
        {visibleState.status === "ready" && visibleState.data.requests.length > 0 && <section className="glass-panel recovery-queue" aria-label="Pending management recovery requests">
          {visibleState.data.requests.map((request) => (
            <article key={request.id} className="recovery-request">
              <header>
                <div>
                  <h2>{request.resourceType === "artist_profile" ? "Profile" : "Release"} management transfer</h2>
                  <p className="analytics-muted">Requested {new Date(request.createdAt).toLocaleString()}</p>
                </div>
              </header>
              <ul className="recovery-resources">
                {request.resources.map((resource) => <li key={resource.id}>{resource.name}</li>)}
              </ul>
              <dl className="recovery-parties">
                <div><dt>Requester</dt><dd>{request.requesterEmail ?? "Email unavailable"}</dd></div>
                <div><dt>Recipient</dt><dd>{request.recipientEmail ?? "Email unavailable"}</dd></div>
              </dl>
              <section className="recovery-evidence" aria-label="Submitted evidence">
                <h3>Evidence</h3>
                <p>{request.evidence}</p>
              </section>
              <label className="review-note-field">
                Review note <span>(required)</span>
                <textarea
                  required
                  maxLength={4000}
                  rows={4}
                  value={reviewNotes[request.id] ?? ""}
                  onChange={(event) => updateReviewNotes((previous) => ({ ...previous, [request.id]: event.target.value }))}
                  aria-describedby={`review-note-hint-${request.id}`}
                />
              </label>
              <p id={`review-note-hint-${request.id}`} className="analytics-muted">Record the reason for your decision.</p>
              {reviewErrors[request.id] && <p role="alert">{reviewErrors[request.id]}</p>}
              <div className="recovery-actions">
                <button
                  type="button"
                  disabled={reviewingRequestId !== null}
                  onClick={() => requestApproval(request)}
                >
                  {reviewingRequestId === request.id ? "Saving…" : "Approve recovery"}
                </button>
                <button
                  type="button"
                  disabled={reviewingRequestId !== null}
                  onClick={() => void review(request.id, "reject")}
                >
                  {reviewingRequestId === request.id ? "Saving…" : "Reject recovery"}
                </button>
              </div>
            </article>
          ))}
        </section>}
        <ConfirmDialog
          isOpen={Boolean(pendingApproval)}
          title="Approve management recovery?"
          message={approvalMessage}
          confirmLabel="Approve recovery"
          variant="warning"
          onCancel={() => setApprovalSnapshot({ scope: sessionScope, request: null })}
          onConfirm={async () => {
            if (pendingApproval) await review(pendingApproval.id, "approve");
          }}
        />
        <style jsx>{`
          .recovery-state { padding: 24px; }
          .recovery-queue { padding: 0 24px; }
          .recovery-request { padding: 24px 0; border-bottom: 1px solid rgba(255,255,255,.1); }
          .recovery-request:last-child { border-bottom: 0; }
          .recovery-request h2 { margin: 0; font-size: 18px; }
          .recovery-request h3 { margin: 0 0 8px; font-size: 14px; }
          .recovery-request p { overflow-wrap: anywhere; }
          .recovery-resources { margin: 12px 0; padding-left: 20px; }
          .recovery-parties { display: grid; gap: 10px; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); margin: 16px 0; }
          .recovery-parties div { min-width: 0; }
          .recovery-parties dt { font-size: 11px; color: var(--r-on-surface-muted, #aaa); }
          .recovery-parties dd { margin: 3px 0 0; overflow-wrap: anywhere; }
          .recovery-evidence { border: 1px solid rgba(255,255,255,.12); border-radius: 10px; background: rgba(255,255,255,.03); padding: 14px; margin: 16px 0; }
          .recovery-evidence p { white-space: pre-wrap; margin: 0; }
          .review-note-field { display: grid; gap: 8px; max-width: 720px; font-weight: 600; }
          .review-note-field span { font-weight: 400; color: var(--r-on-surface-muted, #aaa); }
          .review-note-field textarea { width: 100%; min-height: 90px; border-radius: 10px; padding: 10px; color: var(--r-on-surface); background: var(--r-surface-container, #252430); border: 1px solid rgba(255,255,255,.2); font: inherit; }
          .recovery-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 14px; }
          .recovery-actions button, .recovery-state button { min-height: 44px; padding: 9px 15px; border-radius: 10px; border: 1px solid rgba(255,255,255,.2); color: var(--r-on-surface); background: var(--r-surface-container, #252430); cursor: pointer; }
          .recovery-actions button:disabled { opacity: .5; cursor: not-allowed; }
          @media (max-width: 640px) { .recovery-queue { padding: 0 16px; } }
        `}</style>
      </main>
    </AuthGate>
  );
}
