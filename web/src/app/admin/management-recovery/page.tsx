"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { useToast } from "../../../components/ui/Toast";
import {
  getPendingManagementRecoveries,
  reviewManagementRecovery,
  type ManagementRecoveryDecision,
  type ManagementRecoveryRequest,
} from "../../../lib/api";
import ManagementRecoveryQueueView, { type ManagementRecoveryQueueState } from "./QueueView";

type ScopedValue<T> = { scope: symbol | null; value: T };
type ReviewInFlight = { requestId: string; decision: ManagementRecoveryDecision };

export default function ManagementRecoveryAdminPage() {
  const { token, role, userId } = useAuth();
  const sessionScope = useMemo(
    () => token ? Symbol(userId ?? role ?? "management-recovery-session") : null,
    [role, token, userId],
  );
  const { addToast } = useToast();
  const [stateSnapshot, setStateSnapshot] = useState<ScopedValue<ManagementRecoveryQueueState>>({
    scope: null,
    value: { status: "loading" },
  });
  const [reviewNotesSnapshot, setReviewNotesSnapshot] = useState<ScopedValue<Record<string, string>>>({ scope: null, value: {} });
  const [reviewErrorsSnapshot, setReviewErrorsSnapshot] = useState<ScopedValue<Record<string, string>>>({ scope: null, value: {} });
  const [reviewingSnapshot, setReviewingSnapshot] = useState<ScopedValue<ReviewInFlight | null>>({ scope: null, value: null });
  const [approvalSnapshot, setApprovalSnapshot] = useState<ScopedValue<ManagementRecoveryRequest | null>>({ scope: null, value: null });
  const [rejectionSnapshot, setRejectionSnapshot] = useState<ScopedValue<ManagementRecoveryRequest | null>>({ scope: null, value: null });
  const [successSnapshot, setSuccessSnapshot] = useState<ScopedValue<string | null>>({ scope: null, value: null });
  const loadSequenceRef = useRef(0);
  const currentScopeRef = useRef(sessionScope);
  useLayoutEffect(() => {
    currentScopeRef.current = sessionScope;
    return () => { currentScopeRef.current = null; };
  }, [sessionScope]);

  const canReview = role === "admin" || role === "operator";
  const visibleState: ManagementRecoveryQueueState = !canReview
    ? { status: "forbidden" }
    : token && sessionScope && stateSnapshot.scope === sessionScope
      ? stateSnapshot.value
      : { status: "loading" };
  const reviewNotes = sessionScope && reviewNotesSnapshot.scope === sessionScope ? reviewNotesSnapshot.value : {};
  const reviewErrors = sessionScope && reviewErrorsSnapshot.scope === sessionScope ? reviewErrorsSnapshot.value : {};
  const reviewInFlight = sessionScope && reviewingSnapshot.scope === sessionScope ? reviewingSnapshot.value : null;
  const reviewingRequestId = reviewInFlight?.requestId ?? null;
  const reviewingDecision = reviewInFlight?.decision ?? null;
  const approvalRequest = sessionScope && approvalSnapshot.scope === sessionScope ? approvalSnapshot.value : null;
  const rejectionRequest = sessionScope && rejectionSnapshot.scope === sessionScope ? rejectionSnapshot.value : null;
  const successMessage = sessionScope && successSnapshot.scope === sessionScope ? successSnapshot.value : null;

  const updateReviewNotes = (update: (current: Record<string, string>) => Record<string, string>) => {
    setReviewNotesSnapshot((previous) => {
      const current = sessionScope && previous.scope === sessionScope ? previous.value : {};
      return { scope: sessionScope, value: update(current) };
    });
  };
  const updateReviewErrors = (update: (current: Record<string, string>) => Record<string, string>) => {
    setReviewErrorsSnapshot((previous) => {
      const current = sessionScope && previous.scope === sessionScope ? previous.value : {};
      return { scope: sessionScope, value: update(current) };
    });
  };

  const load = useCallback(async (preserveSuccess = false) => {
    const requestScope = sessionScope;
    if (!token || !requestScope || currentScopeRef.current !== requestScope) return;
    const requestSequence = ++loadSequenceRef.current;
    if (!canReview) {
      setStateSnapshot({ scope: requestScope, value: { status: "forbidden" } });
      return;
    }
    setStateSnapshot({ scope: requestScope, value: { status: "loading" } });
    if (!preserveSuccess) setSuccessSnapshot({ scope: requestScope, value: null });
    try {
      const data = await getPendingManagementRecoveries(token);
      if (currentScopeRef.current === requestScope && requestSequence === loadSequenceRef.current) {
        setStateSnapshot({ scope: requestScope, value: { status: "ready", requests: data.requests } });
      }
    } catch (reason) {
      if (currentScopeRef.current === requestScope && requestSequence === loadSequenceRef.current) {
        setStateSnapshot({
          scope: requestScope,
          value: {
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

  const review = async (request: ManagementRecoveryRequest, decision: ManagementRecoveryDecision) => {
    const requestScope = sessionScope;
    if (!token || !requestScope || currentScopeRef.current !== requestScope || !canReview || reviewingRequestId) return;
    const note = (reviewNotes[request.id] ?? "").trim();
    if (!note) {
      updateReviewErrors((previous) => ({ ...previous, [request.id]: "Add a review note before recording a decision." }));
      return;
    }

    setReviewingSnapshot({ scope: requestScope, value: { requestId: request.id, decision } });
    updateReviewErrors((previous) => ({ ...previous, [request.id]: "" }));
    try {
      await reviewManagementRecovery(token, request.id, { decision, note });
      if (currentScopeRef.current !== requestScope) return;
      updateReviewNotes((previous) => ({ ...previous, [request.id]: "" }));
      setApprovalSnapshot({ scope: requestScope, value: null });
      setRejectionSnapshot({ scope: requestScope, value: null });
      setSuccessSnapshot({
        scope: requestScope,
        value: decision === "approve" ? "Recovery approved." : "Recovery rejected.",
      });
      addToast({
        type: "success",
        title: decision === "approve" ? "Recovery approved" : "Recovery rejected",
        message: "The review decision was recorded.",
      });
      await load(true);
    } catch (reason) {
      if (currentScopeRef.current !== requestScope) return;
      const message = reason instanceof Error ? reason.message : "Unable to record the review decision.";
      updateReviewErrors((previous) => ({ ...previous, [request.id]: message }));
      setApprovalSnapshot({ scope: requestScope, value: null });
      setRejectionSnapshot({ scope: requestScope, value: null });
      addToast({ type: "error", title: "Review decision failed", message });
    } finally {
      if (currentScopeRef.current === requestScope) setReviewingSnapshot({ scope: requestScope, value: null });
    }
  };

  const canRequestDecision = (request: ManagementRecoveryRequest) => {
    if (!sessionScope || currentScopeRef.current !== sessionScope) return false;
    if (!(reviewNotes[request.id] ?? "").trim()) {
      updateReviewErrors((previous) => ({ ...previous, [request.id]: "Add a review note before recording a decision." }));
      return false;
    }
    return true;
  };

  const requestApproval = (request: ManagementRecoveryRequest) => {
    if (!canRequestDecision(request)) return;
    setApprovalSnapshot({ scope: sessionScope, value: request });
  };

  const requestRejection = (request: ManagementRecoveryRequest) => {
    if (!canRequestDecision(request)) return;
    setRejectionSnapshot({ scope: sessionScope, value: request });
  };

  return (
    <AuthGate title="Sign in with an operator account to review management recovery requests.">
      <ManagementRecoveryQueueView
        state={visibleState}
        reviewNotes={reviewNotes}
        reviewErrors={reviewErrors}
        reviewingRequestId={reviewingRequestId}
        reviewingDecision={reviewingDecision}
        approvalRequest={approvalRequest}
        rejectionRequest={rejectionRequest}
        successMessage={successMessage}
        onRetry={() => void load()}
        onReviewNoteChange={(requestId, value) => {
          updateReviewNotes((previous) => ({ ...previous, [requestId]: value }));
          updateReviewErrors((previous) => ({ ...previous, [requestId]: "" }));
        }}
        onRequestApproval={requestApproval}
        onRequestRejection={requestRejection}
        onCancelApproval={() => setApprovalSnapshot({ scope: sessionScope, value: null })}
        onConfirmApproval={async () => {
          if (approvalRequest) await review(approvalRequest, "approve");
        }}
        onCancelRejection={() => setRejectionSnapshot({ scope: sessionScope, value: null })}
        onConfirmRejection={async () => {
          if (rejectionRequest) await review(rejectionRequest, "reject");
        }}
      />
    </AuthGate>
  );
}
