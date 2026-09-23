"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { useToast } from "../../../components/ui/Toast";
import { ArtistClaimCenter } from "../../../components/artist/ArtistClaimCenter";
import {
  canRequestManagementTransferRecovery,
  getArtistManagementAccess,
  getMyManagementRecoveries,
  getMyManagement,
  getReleaseManagementAccess,
  inviteManager,
  inviteManagementTransfer,
  narrowManagementGrant,
  respondToManagementGrant,
  respondToManagementTransfer,
  requestManagementTransferRecovery,
  type ManagementTransferRecovery,
  type ManagementScope,
  type MyManagement,
  type ResourceManagementAccess,
} from "../../../lib/api";

type OwnedResource = { kind: "artist" | "release"; id: string; name: string };

const RELEASE_SCOPES: { value: ManagementScope; label: string }[] = [
  { value: "CATALOG_READ", label: "View managed release" },
  { value: "CATALOG_METADATA", label: "Edit release title" },
  { value: "CATALOG_MEDIA", label: "Replace release artwork" },
  { value: "TRACK_METADATA", label: "Edit track titles and explicit labels" },
  { value: "TRACK_AUDIO", label: "Replace track audio" },
];

type ManagementFormState = {
  selectedKey: string;
  recipientEmail: string;
  scopes: ManagementScope[];
  allReleases: boolean;
  inviteExpiresAt: string;
  editingGrantId: string | null;
  editedScopes: ManagementScope[];
  editedExpiresAt: string;
};

const EMPTY_MANAGEMENT_FORM: ManagementFormState = {
  selectedKey: "",
  recipientEmail: "",
  scopes: ["CATALOG_READ", "CATALOG_METADATA"],
  allReleases: false,
  inviteExpiresAt: "",
  editingGrantId: null,
  editedScopes: [],
  editedExpiresAt: "",
};

export default function ArtistManagementPage() {
  const { token, userId } = useAuth();
  const sessionScope = useMemo(() => token ? Symbol(userId ?? "management-session") : null, [token, userId]);
  const currentScopeRef = useRef(sessionScope);
  const { addToast } = useToast();
  const [managementSnapshot, setManagementSnapshot] = useState<{
    scope: symbol | null;
    data: MyManagement | null;
    loading: boolean;
    error: string | null;
  }>({ scope: null, data: null, loading: true, error: null });
  const [recoverySnapshot, setRecoverySnapshot] = useState<{
    scope: symbol | null;
    transfers: ManagementTransferRecovery[];
    loading: boolean;
    error: string | null;
  }>({ scope: null, transfers: [], loading: true, error: null });
  const [recoveryEvidenceSnapshot, setRecoveryEvidenceSnapshot] = useState<{
    scope: symbol | null;
    values: Record<string, string>;
  }>({ scope: null, values: {} });
  const [recoveryRequestErrorsSnapshot, setRecoveryRequestErrorsSnapshot] = useState<{
    scope: symbol | null;
    values: Record<string, string>;
  }>({ scope: null, values: {} });
  const managementView = sessionScope && managementSnapshot.scope === sessionScope
    ? managementSnapshot
    : { data: null, loading: Boolean(token), error: null };
  const recoveryView = sessionScope && recoverySnapshot.scope === sessionScope
    ? recoverySnapshot
    : { transfers: [], loading: Boolean(token), error: null };
  const data = managementView.data;
  const loading = managementView.loading;
  const error = managementView.error;
  const recoveryTransfers = recoveryView.transfers;
  const recoveryLoading = recoveryView.loading;
  const recoveryError = recoveryView.error;
  const recoveryEvidence = sessionScope && recoveryEvidenceSnapshot.scope === sessionScope
    ? recoveryEvidenceSnapshot.values
    : {};
  const recoveryRequestErrors = sessionScope && recoveryRequestErrorsSnapshot.scope === sessionScope
    ? recoveryRequestErrorsSnapshot.values
    : {};
  const setRecoveryEvidence = (update: React.SetStateAction<Record<string, string>>) => {
    setRecoveryEvidenceSnapshot((previous) => {
      const current = sessionScope && previous.scope === sessionScope ? previous.values : {};
      return { scope: sessionScope, values: typeof update === "function" ? update(current) : update };
    });
  };
  const setRecoveryRequestErrors = (update: React.SetStateAction<Record<string, string>>) => {
    setRecoveryRequestErrorsSnapshot((previous) => {
      const current = sessionScope && previous.scope === sessionScope ? previous.values : {};
      return { scope: sessionScope, values: typeof update === "function" ? update(current) : update };
    });
  };
  const [formSnapshot, setFormSnapshot] = useState<{ scope: symbol | null; value: ManagementFormState }>({
    scope: null,
    value: EMPTY_MANAGEMENT_FORM,
  });
  const form = sessionScope && formSnapshot.scope === sessionScope ? formSnapshot.value : EMPTY_MANAGEMENT_FORM;
  const { selectedKey, recipientEmail, scopes, allReleases, inviteExpiresAt, editingGrantId, editedScopes, editedExpiresAt } = form;
  const updateForm = (update: (previous: ManagementFormState) => ManagementFormState) => {
    if (currentScopeRef.current !== sessionScope) return;
    setFormSnapshot((previous) => {
      const current = sessionScope && previous.scope === sessionScope ? previous.value : EMPTY_MANAGEMENT_FORM;
      return { scope: sessionScope, value: update(current) };
    });
  };
  const setSelectedKey = (value: string) => updateForm((previous) => ({ ...previous, selectedKey: value }));
  const setRecipientEmail = (value: string) => updateForm((previous) => ({ ...previous, recipientEmail: value }));
  const setScopes = (value: React.SetStateAction<ManagementScope[]>) => updateForm((previous) => ({
    ...previous,
    scopes: typeof value === "function" ? value(previous.scopes) : value,
  }));
  const setAllReleases = (value: boolean) => updateForm((previous) => ({ ...previous, allReleases: value }));
  const setInviteExpiresAt = (value: string) => updateForm((previous) => ({ ...previous, inviteExpiresAt: value }));
  const setEditingGrantId = (value: string | null) => updateForm((previous) => ({ ...previous, editingGrantId: value }));
  const setEditedScopes = (value: React.SetStateAction<ManagementScope[]>) => updateForm((previous) => ({
    ...previous,
    editedScopes: typeof value === "function" ? value(previous.editedScopes) : value,
  }));
  const setEditedExpiresAt = (value: string) => updateForm((previous) => ({ ...previous, editedExpiresAt: value }));
  const [busySnapshot, setBusySnapshot] = useState<{ scope: symbol | null; value: boolean }>({ scope: null, value: false });
  const busy = Boolean(sessionScope && busySnapshot.scope === sessionScope && busySnapshot.value);
  const setBusy = (value: boolean) => setBusySnapshot({ scope: sessionScope, value });
  const [submittingRecoverySnapshot, setSubmittingRecoverySnapshot] = useState<{ scope: symbol | null; transferId: string | null }>({ scope: null, transferId: null });
  const submittingRecoveryTransferId = sessionScope && submittingRecoverySnapshot.scope === sessionScope
    ? submittingRecoverySnapshot.transferId
    : null;
  const [accessSnapshot, setAccessSnapshot] = useState<{
    scope: symbol | null;
    selectedKey: string;
    value: ResourceManagementAccess | null;
  }>({ scope: null, selectedKey: "", value: null });
  const access = sessionScope && accessSnapshot.scope === sessionScope && accessSnapshot.selectedKey === selectedKey
    ? accessSnapshot.value
    : null;
  const setAccess = (value: ResourceManagementAccess | null) => {
    setAccessSnapshot({ scope: sessionScope, selectedKey, value });
  };
  const managementLoadSequenceRef = useRef(0);
  const recoveryLoadSequenceRef = useRef(0);
  useLayoutEffect(() => {
    currentScopeRef.current = sessionScope;
    setFormSnapshot((previous) => previous.scope === sessionScope
      ? previous
      : { scope: sessionScope, value: EMPTY_MANAGEMENT_FORM });
    return () => { currentScopeRef.current = null; };
  }, [sessionScope]);

  const refreshRecoveryTransfers = useCallback(async () => {
    const requestScope = sessionScope;
    if (!token || !requestScope || currentScopeRef.current !== requestScope) {
      return;
    }
    const requestSequence = ++recoveryLoadSequenceRef.current;
    setRecoverySnapshot((previous) => ({
      scope: requestScope,
      transfers: previous.scope === requestScope ? previous.transfers : [],
      loading: true,
      error: null,
    }));
    try {
      const response = await getMyManagementRecoveries(token);
      if (currentScopeRef.current === requestScope && requestSequence === recoveryLoadSequenceRef.current) {
        setRecoverySnapshot({ scope: requestScope, transfers: response.transfers, loading: false, error: null });
      }
    } catch (reason) {
      if (currentScopeRef.current === requestScope && requestSequence === recoveryLoadSequenceRef.current) {
        setRecoverySnapshot((previous) => ({
          scope: requestScope,
          transfers: previous.scope === requestScope ? previous.transfers : [],
          loading: false,
          error: reason instanceof Error ? reason.message : "Unable to load accepted transfers.",
        }));
      }
    }
  }, [sessionScope, token]);

  const refresh = useCallback(async () => {
    if (!token || !sessionScope || currentScopeRef.current !== sessionScope) return;
    const requestScope = sessionScope;
    const requestSequence = ++managementLoadSequenceRef.current;
    setManagementSnapshot((previous) => ({
      scope: requestScope,
      data: previous.scope === requestScope ? previous.data : null,
      loading: true,
      error: null,
    }));
    try {
      const next = await getMyManagement(token);
      if (currentScopeRef.current === requestScope && requestSequence === managementLoadSequenceRef.current) {
        setManagementSnapshot({ scope: requestScope, data: next, loading: false, error: null });
      }
    } catch (reason) {
      if (currentScopeRef.current === requestScope && requestSequence === managementLoadSequenceRef.current) {
        setManagementSnapshot((previous) => ({
          scope: requestScope,
          data: previous.scope === requestScope ? previous.data : null,
          loading: false,
          error: reason instanceof Error ? reason.message : "Unable to load management access.",
        }));
      }
      throw reason;
    }
    await refreshRecoveryTransfers();
  }, [refreshRecoveryTransfers, sessionScope, token]);

  useEffect(() => {
    if (!token || !sessionScope) {
      ++managementLoadSequenceRef.current;
      ++recoveryLoadSequenceRef.current;
      setManagementSnapshot({ scope: null, data: null, loading: false, error: null });
      setRecoverySnapshot({ scope: null, transfers: [], loading: false, error: null });
      return;
    }
    void refresh().catch(() => undefined);
  }, [refresh, sessionScope, token]);

  const resources = useMemo<OwnedResource[]>(() => [
    ...(data?.ownedArtists ?? []).map((artist) => ({ kind: "artist" as const, id: artist.id, name: artist.name })),
    ...(data?.ownedReleases ?? []).map((release) => ({ kind: "release" as const, id: release.id, name: release.title })),
  ], [data]);
  const selected = resources.find((resource) => `${resource.kind}:${resource.id}` === selectedKey) ?? null;

  useEffect(() => {
    if (!token || !selected) {
      setAccessSnapshot({ scope: sessionScope, selectedKey, value: null });
      return;
    }
    const requestScope = sessionScope;
    const selectedResourceKey = `${selected.kind}:${selected.id}`;
    if (!requestScope) return;
    let active = true;
    const request = selected.kind === "artist"
      ? getArtistManagementAccess(token, selected.id)
      : getReleaseManagementAccess(token, selected.id);
    request.then((next) => {
      if (active) setAccessSnapshot({ scope: requestScope, selectedKey: selectedResourceKey, value: next });
    })
      .catch(() => {
        if (active) setAccessSnapshot({ scope: requestScope, selectedKey: selectedResourceKey, value: null });
      });
    return () => { active = false; };
  }, [selectedKey, sessionScope, token, selected]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    const requestScope = sessionScope;
    if (!token || !requestScope || busy || currentScopeRef.current !== requestScope) return;
    setBusy(true);
    try {
      await action();
      if (currentScopeRef.current !== requestScope) return;
      await refresh();
      if (currentScopeRef.current !== requestScope) return;
      if (selected) {
        const nextAccess = await (selected.kind === "artist"
          ? getArtistManagementAccess(token, selected.id)
          : getReleaseManagementAccess(token, selected.id)).catch(() => null);
        setAccess(nextAccess);
      }
      setEditingGrantId(null);
      addToast({ type: "success", title: success });
    } catch (reason) {
      if (currentScopeRef.current !== requestScope) return;
      addToast({
        type: "error",
        title: "Management request failed",
        message: reason instanceof Error ? reason.message : "Please try again.",
      });
    } finally {
      if (currentScopeRef.current === requestScope) setBusy(false);
    }
  };

  const invite = (event: React.FormEvent) => {
    event.preventDefault();
    if (!token || !selected) return;
    const chosenScopes: ManagementScope[] = selected.kind === "artist" ? ["PROFILE_EDIT"] : scopes;
    if (!chosenScopes.length) return;
    void run(() => inviteManager(token, {
      recipientEmail: recipientEmail.trim(),
      ...(selected.kind === "artist" ? { artistId: selected.id } : { releaseId: selected.id }),
      scopes: chosenScopes,
      ...(inviteExpiresAt ? { expiresAt: new Date(inviteExpiresAt).toISOString() } : {}),
    }), "Invitation sent");
  };

  const editGrant = (grant: ResourceManagementAccess["grants"][number]) => {
    setEditingGrantId(grant.id);
    setEditedScopes(grant.scopes);
    setEditedExpiresAt(grant.expiresAt ? toLocalDateTime(grant.expiresAt) : "");
  };

  const saveGrant = (event: React.FormEvent, grant: ResourceManagementAccess["grants"][number]) => {
    event.preventDefault();
    if (!token || editedScopes.length === 0) return;
    const scopeChanged = editedScopes.length !== grant.scopes.length
      || editedScopes.some((scope) => !grant.scopes.includes(scope));
    const expiryChanged = editedExpiresAt !== (grant.expiresAt ? toLocalDateTime(grant.expiresAt) : "");
    if (!scopeChanged && !expiryChanged) return;
    if (expiryChanged && !editedExpiresAt) {
      addToast({ type: "error", title: "Choose an expiry", message: "Access can only be shortened here." });
      return;
    }
    void run(() => narrowManagementGrant(token, grant.id, {
      ...(scopeChanged ? { scopes: editedScopes } : {}),
      ...(expiryChanged ? { expiresAt: new Date(editedExpiresAt).toISOString() } : {}),
    }), "Access updated");
  };

  const transfer = () => {
    if (!token || !selected) return;
    void run(() => inviteManagementTransfer(token, {
      recipientEmail: recipientEmail.trim(),
      ...(selected.kind === "artist"
        ? { artistId: selected.id }
        : allReleases ? { allManagedReleases: true } : { releaseIds: [selected.id] }),
    }), "Transfer invitation sent");
  };

  const submitRecoveryRequest = (event: React.FormEvent, transfer: ManagementTransferRecovery) => {
    event.preventDefault();
    const requestScope = sessionScope;
    if (!token || !requestScope || currentScopeRef.current !== requestScope || !canRequestManagementTransferRecovery(transfer)
      || submittingRecoveryTransferId === transfer.id) return;

    const evidence = recoveryEvidence[transfer.id] ?? "";
    const trimmedEvidence = evidence.trim();
    if (trimmedEvidence.length < 20 || trimmedEvidence.length > 4000) {
      setRecoveryRequestErrors((previous) => ({
        ...previous,
        [transfer.id]: "Evidence must be between 20 and 4,000 characters.",
      }));
      return;
    }

    setSubmittingRecoverySnapshot({ scope: requestScope, transferId: transfer.id });
    setRecoveryRequestErrors((previous) => ({ ...previous, [transfer.id]: "" }));
    void (async () => {
      try {
        await requestManagementTransferRecovery(token, transfer.id, trimmedEvidence);
        if (currentScopeRef.current !== requestScope) return;
        await refreshRecoveryTransfers();
        if (currentScopeRef.current !== requestScope) return;
        setRecoveryEvidence((previous) => ({ ...previous, [transfer.id]: "" }));
        addToast({
          type: "success",
          title: "Review requested",
          message: "An operator will review the evidence. Management will not change automatically.",
        });
      } catch (reason) {
        if (currentScopeRef.current !== requestScope) return;
        const message = reason instanceof Error ? reason.message : "Unable to request a recovery review.";
        setRecoveryRequestErrors((previous) => ({ ...previous, [transfer.id]: message }));
        addToast({ type: "error", title: "Recovery request failed", message });
      } finally {
        if (currentScopeRef.current === requestScope) setSubmittingRecoverySnapshot({ scope: requestScope, transferId: null });
      }
    })();
  };

  return (
    <AuthGate title="Connect your wallet to manage artist access.">
      <main className="analytics-container" style={{ padding: "12px 0 64px" }}>
        <header className="analytics-header-section">
          <p className="artist-analytics-eyebrow">Artist management</p>
          <h1>Profiles and releases</h1>
          <p className="analytics-muted">Request access to a credited artist profile, or invite someone to manage a profile or release you control. Access requires review or acceptance. Credits, rights, and payouts stay separate.</p>
        </header>

        {token && <ArtistClaimCenter key={token} token={token} />}

        {loading && <p role="status">Loading management access…</p>}
        {error && <p role="alert">{error} <button type="button" onClick={() => void refresh()}>Try again</button></p>}
        {!loading && data && <>
          <section className="glass-panel" style={{ padding: 24, marginBottom: 24 }} aria-labelledby="pending-heading">
            <h2 id="pending-heading">Requests for you</h2>
            {data.pendingGrants.length === 0 && data.pendingTransfers.length === 0 && <p className="analytics-muted">No invitations waiting for you.</p>}
            {data.pendingGrants.map((grant) => <div key={grant.id} className="artist-management-row">
              <div><strong>{grant.resourceName ?? "Management invitation"}</strong><p className="analytics-muted">{grant.scopes.map(scopeLabel).join(", ")}</p></div>
              <div className="artist-management-actions">
                <button type="button" disabled={busy} onClick={() => token && void run(() => respondToManagementGrant(token, grant.id, "accept"), "Access accepted")}>Accept</button>
                <button type="button" disabled={busy} onClick={() => token && void run(() => respondToManagementGrant(token, grant.id, "decline"), "Invitation declined")}>Decline</button>
              </div>
            </div>)}
            {data.pendingTransfers.map((transfer) => <div key={transfer.id} className="artist-management-row">
              <div><strong>{transfer.resourceType === "artist_profile" ? "Profile" : "Release"} management transfer</strong>
                <ul className="artist-management-resource-list">{transfer.resources?.map((resource) => <li key={resource.id}>{resource.name}</li>)}</ul>
                <p className="analytics-muted">{transfer.resourceIds.length} {transfer.resourceIds.length === 1 ? "resource" : "resources"} · existing manager invitations end · rights and payouts stay separate</p>
              </div>
              <div className="artist-management-actions">
                <button type="button" disabled={busy} onClick={() => token && void run(() => respondToManagementTransfer(token, transfer.id, "accept"), "Transfer accepted")}>Accept</button>
                <button type="button" disabled={busy} onClick={() => token && void run(() => respondToManagementTransfer(token, transfer.id, "decline"), "Transfer declined")}>Decline</button>
              </div>
            </div>)}
          </section>

          <section className="glass-panel" style={{ padding: 24, marginBottom: 24 }} aria-labelledby="accepted-transfers-heading">
            <h2 id="accepted-transfers-heading">Accepted management transfers</h2>
            <p className="analytics-muted">
              You can request an operator review for an eligible transfer you proposed. Submitting evidence does not automatically reverse management access. Credits, rights, and payouts do not move through this process.
            </p>
            {recoveryLoading && <p role="status">Loading accepted transfers…</p>}
            {recoveryError && <p role="alert">{recoveryError} <button type="button" onClick={() => void refreshRecoveryTransfers()}>Try again</button></p>}
            {!recoveryLoading && !recoveryError && recoveryTransfers.length === 0 && <p className="analytics-muted">No accepted transfers are available for review.</p>}
            {!recoveryLoading && !recoveryError && recoveryTransfers.map((acceptedTransfer) => {
              const resourceNames = acceptedTransfer.resources.map((resource) => resource.name);
              const status = acceptedTransfer.recovery?.status;
              const canRequest = canRequestManagementTransferRecovery(acceptedTransfer);
              const statusMessage = status === "pending"
                ? "A recovery request is pending operator review."
                : status === "approved"
                  ? "An operator approved the recovery request."
                  : status === "rejected"
                    ? "An operator rejected the recovery request."
                    : null;
              return (
                <div key={acceptedTransfer.id} className="artist-management-row accepted-transfer-recovery">
                  <div>
                    <strong>{acceptedTransfer.resourceType === "artist_profile" ? "Profile" : "Release"} management transfer</strong>
                    <ul className="artist-management-resource-list">
                      {resourceNames.map((name, index) => <li key={`${acceptedTransfer.resourceIds[index] ?? name}-${index}`}>{name}</li>)}
                    </ul>
                    <p className="analytics-muted">{acceptedTransfer.acceptedAt
                      ? `Accepted ${new Date(acceptedTransfer.acceptedAt).toLocaleString()}`
                      : "Acceptance time unavailable"}</p>
                    {statusMessage && <p className="analytics-muted" role="status">
                      {statusMessage}{acceptedTransfer.recovery?.reviewedAt ? ` Reviewed ${new Date(acceptedTransfer.recovery.reviewedAt).toLocaleString()}.` : ""}
                    </p>}
                    {canRequest ? <form className="artist-management-form" onSubmit={(event) => submitRecoveryRequest(event, acceptedTransfer)}>
                      {status === "rejected" && <p className="analytics-muted">You may submit new evidence while this transfer remains eligible.</p>}
                      <label className="artist-management-field">Evidence for operator review
                        <textarea
                          required
                          minLength={20}
                          maxLength={4000}
                          rows={5}
                          value={recoveryEvidence[acceptedTransfer.id] ?? ""}
                          onChange={(event) => setRecoveryEvidence((previous) => ({ ...previous, [acceptedTransfer.id]: event.target.value }))}
                          aria-describedby={`recovery-evidence-hint-${acceptedTransfer.id}`}
                        />
                      </label>
                      <p id={`recovery-evidence-hint-${acceptedTransfer.id}`} className="analytics-muted">Provide 20 to 4,000 characters. An operator reviews the request; this is not an automatic reversion.</p>
                      {recoveryRequestErrors[acceptedTransfer.id] && <p role="alert">{recoveryRequestErrors[acceptedTransfer.id]}</p>}
                      <button type="submit" disabled={submittingRecoveryTransferId === acceptedTransfer.id}>
                        {submittingRecoveryTransferId === acceptedTransfer.id ? "Sending request…" : "Request operator review"}
                      </button>
                    </form> : (!statusMessage || status === "rejected") && <p className="analytics-muted">This transfer is not currently eligible for another operator review request.</p>}
                  </div>
                </div>
              );
            })}
          </section>

          <section className="glass-panel" style={{ padding: 24, marginBottom: 24 }} aria-labelledby="owned-heading">
            <h2 id="owned-heading">What you manage</h2>
            {resources.length === 0 && <p className="analytics-muted">You do not currently own management of a profile or release.</p>}
            {resources.length > 0 && <label className="artist-management-field">Choose a resource
              <select value={selectedKey} onChange={(event) => { setSelectedKey(event.target.value); setAccess(null); setAllReleases(false); }}>
                <option value="">Select a profile or release</option>
                {resources.map((resource) => <option key={`${resource.kind}:${resource.id}`} value={`${resource.kind}:${resource.id}`}>
                  {resource.kind === "artist" ? "Profile" : "Release"}: {resource.name}
                </option>)}
              </select>
            </label>}

            {selected && <>
              <p className="analytics-muted">Invitations grant only the selected permissions. A release invitation does not grant access to other releases by the same artist.</p>
              <form onSubmit={invite} className="artist-management-form">
                <label className="artist-management-field">Recipient account email
                  <input type="email" required value={recipientEmail} onChange={(event) => setRecipientEmail(event.target.value)} placeholder="manager@example.com" />
                </label>
                {selected.kind === "artist" ? <p>Profile details only</p> : <fieldset>
                  <legend>Release permissions</legend>
                  {RELEASE_SCOPES.map((scope) => <label key={scope.value} className="artist-management-checkbox">
                    <input type="checkbox" checked={scopes.includes(scope.value)} onChange={(event) => setScopes((previous) => event.target.checked ? [...previous, scope.value] : previous.filter((item) => item !== scope.value))} />
                    {scope.label}
                  </label>)}
                </fieldset>}
                <label className="artist-management-field">Access expires (optional)
                  <input type="datetime-local" value={inviteExpiresAt} onChange={(event) => setInviteExpiresAt(event.target.value)} min={toLocalDateTime(new Date().toISOString())} />
                </label>
                <button type="submit" disabled={busy || (selected.kind === "release" && scopes.length === 0)}>Send invitation</button>
              </form>

              <div className="artist-management-transfer">
                <h3>Transfer management</h3>
                <p className="analytics-muted">The recipient must accept. Your management access and existing manager invitations for that resource end then. This does not move rights or payouts.</p>
                {selected.kind === "release" && <label className="artist-management-checkbox">
                  <input type="checkbox" checked={allReleases} onChange={(event) => setAllReleases(event.target.checked)} />
                  Transfer all releases I currently manage
                </label>}
                <button type="button" disabled={busy || !recipientEmail.trim()} onClick={transfer}>Invite transfer</button>
              </div>

              {access?.currentUserAccess.isOwner && <div className="artist-management-grants">
                <h3>Access history for {selected.name}</h3>
                {access.grants.length === 0 && <p className="analytics-muted">No invitations yet.</p>}
                {access.grants.map((grant) => {
                  const expired = !!grant.expiresAt && new Date(grant.expiresAt).getTime() <= Date.now();
                  return <div key={grant.id} className="artist-management-row">
                  <div><strong>{grant.granteeEmail ?? "Invited account"}</strong><p className="analytics-muted">{expired && grant.status === "active" ? "expired" : grant.status} · {grant.scopes.map(scopeLabel).join(", ")}{grant.expiresAt ? ` · Expires ${new Date(grant.expiresAt).toLocaleString()}` : " · No expiry"}</p>
                    {editingGrantId === grant.id && <form className="artist-management-form" onSubmit={(event) => saveGrant(event, grant)}>
                      <fieldset><legend>Keep permissions</legend>
                        {(selected.kind === "artist" ? [{ value: "PROFILE_EDIT" as ManagementScope, label: "Profile details" }] : RELEASE_SCOPES)
                          .filter((scope) => grant.scopes.includes(scope.value))
                          .map((scope) => <label key={scope.value} className="artist-management-checkbox"><input type="checkbox" checked={editedScopes.includes(scope.value)} onChange={(event) => setEditedScopes((previous) => event.target.checked ? [...previous, scope.value] : previous.filter((item) => item !== scope.value))} />{scope.label}</label>)}
                      </fieldset>
                      <label className="artist-management-field">End access on or before current expiry
                        <input type="datetime-local" value={editedExpiresAt} onChange={(event) => setEditedExpiresAt(event.target.value)} min={toLocalDateTime(new Date().toISOString())} max={grant.expiresAt ? toLocalDateTime(grant.expiresAt) : undefined} />
                      </label>
                      <p className="analytics-muted">Pending invitations for this manager and resource will end. To add permissions or extend access, send a new invitation. To remove all access, revoke it.</p>
                      <div className="artist-management-actions"><button type="submit" disabled={busy || editedScopes.length === 0}>Save access</button><button type="button" onClick={() => setEditingGrantId(null)}>Cancel</button></div>
                    </form>}
                  </div>
                  {(grant.status === "pending" || grant.status === "active") && <div className="artist-management-actions">{grant.status === "active" && !expired && <button type="button" disabled={busy} onClick={() => editGrant(grant)}>Edit access</button>}<button type="button" disabled={busy} onClick={() => token && void run(() => respondToManagementGrant(token, grant.id, "revoke"), "Access revoked")}>Revoke</button></div>}
                </div>;})}
              </div>}
            </>}
          </section>

          {data.outgoingTransfers.length > 0 && <section className="glass-panel" style={{ padding: 24, marginBottom: 24 }} aria-label="Transfers you sent">
            <h2>Transfers you sent</h2>
            {data.outgoingTransfers.map((transfer) => <div key={transfer.id} className="artist-management-row">
              <div><strong>{transfer.recipientEmail ?? "Recipient"}</strong><p className="analytics-muted">{transfer.resources?.map((resource) => resource.name).join(", ") || `${transfer.resourceIds.length} resources`} pending</p></div>
              <button type="button" disabled={busy} onClick={() => token && void run(() => respondToManagementTransfer(token, transfer.id, "cancel"), "Transfer cancelled")}>Cancel</button>
            </div>)}
          </section>}

          {(data.managedArtists.length > 0 || data.managedReleases.length > 0) && <section className="glass-panel" style={{ padding: 24 }} aria-label="Delegated access">
            <h2>Access delegated to you</h2>
            {data.managedArtists.map((artist) => <p key={artist.id}><Link href={`/artist/${encodeURIComponent(artist.id)}`}>{artist.name}</Link> <span className="analytics-muted">· profile edit{artist.source === "approved_claim" ? " · approved claim" : ""}</span></p>)}
            {data.managedReleases.map((release) => <p key={release.id}><Link href={`/release/${encodeURIComponent(release.id)}`}>{release.title}</Link> <span className="analytics-muted">· {release.scopes?.map(scopeLabel).join(", ")}</span></p>)}
          </section>}
        </>}
        <style jsx>{`
          .artist-management-row { display: flex; align-items: center; justify-content: space-between; gap: 18px; border-top: 1px solid rgba(255,255,255,.1); padding: 16px 0; }
          .artist-management-grants .artist-management-row { align-items: flex-start; }
          .artist-management-row p { margin: 4px 0 0; }
          .artist-management-resource-list { max-height: 160px; overflow-y: auto; margin: 6px 0; padding-left: 20px; }
          .artist-management-actions { display: flex; gap: 8px; }
          .artist-management-form { display: grid; gap: 16px; max-width: 560px; margin: 18px 0; }
          .artist-management-field { display: grid; gap: 8px; max-width: 560px; }
          .artist-management-field input, .artist-management-field select, .artist-management-field textarea { width: 100%; min-height: 44px; border-radius: 10px; padding: 10px; color: var(--r-on-surface); background: var(--r-surface-container, #252430); border: 1px solid rgba(255,255,255,.2); font: inherit; }
          .artist-management-form fieldset { display: grid; gap: 3px; border: 1px solid rgba(255,255,255,.15); border-radius: 10px; padding: 8px 14px 12px; margin: 0; }
          .artist-management-form legend { color: var(--r-on-surface); padding: 0 5px; font-weight: 600; }
          .artist-management-checkbox { display: flex; align-items: center; gap: 10px; min-height: 42px; }
          .artist-management-checkbox input { width: 18px; height: 18px; }
          .artist-management-transfer, .artist-management-grants { border-top: 1px solid rgba(255,255,255,.1); margin-top: 24px; padding-top: 18px; }
          button { min-height: 44px; padding: 9px 15px; border-radius: 10px; border: 1px solid rgba(255,255,255,.2); color: var(--r-on-surface); background: var(--r-surface-container, #252430); cursor: pointer; }
          button:disabled { opacity: .5; cursor: not-allowed; }
          @media (max-width: 640px) { .artist-management-row { align-items: stretch; flex-direction: column; } .artist-management-actions { flex-wrap: wrap; } }
        `}</style>
      </main>
    </AuthGate>
  );
}

function scopeLabel(scope: ManagementScope) {
  return {
    PROFILE_EDIT: "Profile details",
    CATALOG_READ: "View release",
    CATALOG_METADATA: "Edit release title",
    CATALOG_MEDIA: "Replace artwork",
    TRACK_METADATA: "Edit track details",
    TRACK_AUDIO: "Replace track audio",
  }[scope];
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
