"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { useToast } from "../../../components/ui/Toast";
import {
  getPendingArtistClaims,
  reviewArtistClaim,
  type ArtistClaimDecision,
  type PendingArtistClaim,
} from "../../../lib/api";
import ArtistClaimsQueueView, { reviewerIsClaimant, type ArtistClaimsQueueState } from "./QueueView";

type ScopedValue<T> = { scope: symbol | null; value: T };

export default function ArtistClaimsAdminPage() {
  const { token, role, userId } = useAuth();
  const sessionScope = useMemo(
    () => token ? Symbol(userId ?? role ?? "artist-claims-session") : null,
    [role, token, userId],
  );
  const { addToast } = useToast();
  const [stateSnapshot, setStateSnapshot] = useState<ScopedValue<ArtistClaimsQueueState>>({
    scope: null,
    value: { status: "loading" },
  });
  const [reviewNotesSnapshot, setReviewNotesSnapshot] = useState<ScopedValue<Record<string, string>>>({ scope: null, value: {} });
  const [reviewErrorsSnapshot, setReviewErrorsSnapshot] = useState<ScopedValue<Record<string, string>>>({ scope: null, value: {} });
  const [reviewingSnapshot, setReviewingSnapshot] = useState<ScopedValue<string | null>>({ scope: null, value: null });
  const [approvalSnapshot, setApprovalSnapshot] = useState<ScopedValue<PendingArtistClaim | null>>({ scope: null, value: null });
  const [successSnapshot, setSuccessSnapshot] = useState<ScopedValue<string | null>>({ scope: null, value: null });
  const loadSequenceRef = useRef(0);
  const currentScopeRef = useRef(sessionScope);
  useLayoutEffect(() => {
    currentScopeRef.current = sessionScope;
    return () => { currentScopeRef.current = null; };
  }, [sessionScope]);

  const canReview = role === "admin" || role === "operator";
  const visibleState: ArtistClaimsQueueState = !canReview
    ? { status: "forbidden" }
    : token && sessionScope && stateSnapshot.scope === sessionScope
      ? stateSnapshot.value
      : { status: "loading" };
  const reviewNotes = sessionScope && reviewNotesSnapshot.scope === sessionScope ? reviewNotesSnapshot.value : {};
  const reviewErrors = sessionScope && reviewErrorsSnapshot.scope === sessionScope ? reviewErrorsSnapshot.value : {};
  const reviewingClaimId = sessionScope && reviewingSnapshot.scope === sessionScope ? reviewingSnapshot.value : null;
  const approvalClaim = sessionScope && approvalSnapshot.scope === sessionScope ? approvalSnapshot.value : null;
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
      const claims = await getPendingArtistClaims(token);
      if (currentScopeRef.current === requestScope && requestSequence === loadSequenceRef.current) {
        setStateSnapshot({ scope: requestScope, value: { status: "ready", claims } });
      }
    } catch (reason) {
      if (currentScopeRef.current === requestScope && requestSequence === loadSequenceRef.current) {
        setStateSnapshot({
          scope: requestScope,
          value: {
            status: "error",
            message: reason instanceof Error ? reason.message : "Unable to load pending artist claims.",
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

  const review = async (claim: PendingArtistClaim, decision: ArtistClaimDecision) => {
    const requestScope = sessionScope;
    if (!token || !requestScope || currentScopeRef.current !== requestScope || !canReview || reviewingClaimId) return;

    if (reviewerIsClaimant(userId, claim.claimantUserId)) {
      updateReviewErrors((previous) => ({ ...previous, [claim.id]: "An independent operator must review this claim." }));
      return;
    }

    const note = (reviewNotes[claim.id] ?? "").trim();
    if (!note) {
      updateReviewErrors((previous) => ({ ...previous, [claim.id]: "Add a review note before recording a decision." }));
      return;
    }

    setReviewingSnapshot({ scope: requestScope, value: claim.id });
    updateReviewErrors((previous) => ({ ...previous, [claim.id]: "" }));
    try {
      await reviewArtistClaim(token, claim.id, { decision, note });
      if (currentScopeRef.current !== requestScope) return;
      updateReviewNotes((previous) => ({ ...previous, [claim.id]: "" }));
      setApprovalSnapshot({ scope: requestScope, value: null });
      setSuccessSnapshot({
        scope: requestScope,
        value: decision === "approve" ? "Artist claim approved." : "Artist claim rejected.",
      });
      addToast({
        type: "success",
        title: decision === "approve" ? "Artist claim approved" : "Artist claim rejected",
        message: "The review decision was recorded.",
      });
      await load(true);
    } catch (reason) {
      if (currentScopeRef.current !== requestScope) return;
      const message = reason instanceof Error ? reason.message : "Unable to record the review decision.";
      updateReviewErrors((previous) => ({ ...previous, [claim.id]: message }));
      setApprovalSnapshot({ scope: requestScope, value: null });
      addToast({ type: "error", title: "Review decision failed", message });
    } finally {
      if (currentScopeRef.current === requestScope) setReviewingSnapshot({ scope: requestScope, value: null });
    }
  };

  const requestApproval = (claim: PendingArtistClaim) => {
    if (!sessionScope || currentScopeRef.current !== sessionScope) return;
    if (reviewerIsClaimant(userId, claim.claimantUserId)) {
      updateReviewErrors((previous) => ({ ...previous, [claim.id]: "An independent operator must review this claim." }));
      return;
    }
    if (!(reviewNotes[claim.id] ?? "").trim()) {
      updateReviewErrors((previous) => ({ ...previous, [claim.id]: "Add a review note before recording a decision." }));
      return;
    }
    setApprovalSnapshot({ scope: sessionScope, value: claim });
  };

  return (
    <AuthGate title="Sign in with an operator account to review artist claims.">
      <ArtistClaimsQueueView
        state={visibleState}
        reviewerUserId={userId}
        reviewNotes={reviewNotes}
        reviewErrors={reviewErrors}
        reviewingClaimId={reviewingClaimId}
        approvalClaim={approvalClaim}
        successMessage={successMessage}
        onRetry={() => void load()}
        onReviewNoteChange={(claimId, value) => {
          updateReviewNotes((previous) => ({ ...previous, [claimId]: value }));
          updateReviewErrors((previous) => ({ ...previous, [claimId]: "" }));
        }}
        onRequestApproval={requestApproval}
        onReject={(claim) => void review(claim, "reject")}
        onCancelApproval={() => setApprovalSnapshot({ scope: sessionScope, value: null })}
        onConfirmApproval={async () => {
          if (approvalClaim) await review(approvalClaim, "approve");
        }}
      />
    </AuthGate>
  );
}
