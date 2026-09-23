"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import { useToast } from "../../../components/ui/Toast";
import {
  getArtistManagementAccess,
  getMyManagement,
  getReleaseManagementAccess,
  inviteManager,
  inviteManagementTransfer,
  narrowManagementGrant,
  respondToManagementGrant,
  respondToManagementTransfer,
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
];

export default function ArtistManagementPage() {
  const { token } = useAuth();
  const { addToast } = useToast();
  const [data, setData] = useState<MyManagement | null>(null);
  const [access, setAccess] = useState<ResourceManagementAccess | null>(null);
  const [selectedKey, setSelectedKey] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [scopes, setScopes] = useState<ManagementScope[]>(["CATALOG_READ", "CATALOG_METADATA"]);
  const [allReleases, setAllReleases] = useState(false);
  const [inviteExpiresAt, setInviteExpiresAt] = useState("");
  const [editingGrantId, setEditingGrantId] = useState<string | null>(null);
  const [editedScopes, setEditedScopes] = useState<ManagementScope[]>([]);
  const [editedExpiresAt, setEditedExpiresAt] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    const next = await getMyManagement(token);
    setData(next);
  }, [token]);

  useEffect(() => {
    if (!token) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    getMyManagement(token)
      .then((next) => { if (active) { setData(next); setError(null); } })
      .catch((reason) => {
        if (active) setError(reason instanceof Error ? reason.message : "Unable to load management access.");
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const resources = useMemo<OwnedResource[]>(() => [
    ...(data?.ownedArtists ?? []).map((artist) => ({ kind: "artist" as const, id: artist.id, name: artist.name })),
    ...(data?.ownedReleases ?? []).map((release) => ({ kind: "release" as const, id: release.id, name: release.title })),
  ], [data]);
  const selected = resources.find((resource) => `${resource.kind}:${resource.id}` === selectedKey) ?? null;

  useEffect(() => {
    if (!token || !selected) {
      setAccess(null);
      return;
    }
    let active = true;
    const request = selected.kind === "artist"
      ? getArtistManagementAccess(token, selected.id)
      : getReleaseManagementAccess(token, selected.id);
    request.then((next) => { if (active) setAccess(next); })
      .catch(() => { if (active) setAccess(null); });
    return () => { active = false; };
  }, [token, selected]);

  const run = async (action: () => Promise<unknown>, success: string) => {
    if (!token || busy) return;
    setBusy(true);
    try {
      await action();
      await refresh();
      if (selected) {
        const nextAccess = await (selected.kind === "artist"
          ? getArtistManagementAccess(token, selected.id)
          : getReleaseManagementAccess(token, selected.id)).catch(() => null);
        setAccess(nextAccess);
      }
      setEditingGrantId(null);
      addToast({ type: "success", title: success });
    } catch (reason) {
      addToast({
        type: "error",
        title: "Management request failed",
        message: reason instanceof Error ? reason.message : "Please try again.",
      });
    } finally {
      setBusy(false);
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

  return (
    <AuthGate title="Connect your wallet to manage artist access.">
      <main className="analytics-container" style={{ padding: "12px 0 64px" }}>
        <header className="analytics-header-section">
          <p className="artist-analytics-eyebrow">Artist management</p>
          <h1>Profiles and releases</h1>
          <p className="analytics-muted">Invite someone to manage a specific profile or release. They must accept before access begins. Credits, rights, and payouts stay separate.</p>
        </header>

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
          .artist-management-field input, .artist-management-field select { width: 100%; min-height: 44px; border-radius: 10px; padding: 10px; color: var(--r-on-surface); background: var(--r-surface-container, #252430); border: 1px solid rgba(255,255,255,.2); }
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
  }[scope];
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}
