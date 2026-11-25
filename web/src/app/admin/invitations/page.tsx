"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import AuthGate from "../../../components/auth/AuthGate";
import { useAuth } from "../../../components/auth/AuthProvider";
import {
  createAdminInvitation,
  deleteWaitlistEntry,
  inviteWaitlistEntry,
  listAdminInvitations,
  listWaitlist,
  revokeAdminInvitation,
  type InvitationRole,
  type InvitationSummary,
  type WaitlistEntry,
} from "../../../lib/api";
import { waitlistToCsv } from "./waitlistCsv";
import styles from "./invitations.module.css";

function messageOf(error: unknown) {
  return error instanceof Error ? error.message : "Something went wrong. Please try again.";
}

function formatDate(value: string | null) {
  return value ? new Date(value).toLocaleDateString() : "—";
}

type Overview = Awaited<ReturnType<typeof listAdminInvitations>>;

/** #2662: create and revoke invitation codes, and work the waiting list. Operators only; the server enforces it. */
function Invitations() {
  const { token, role } = useAuth();
  const allowed = role === "admin" || role === "operator";
  const [overview, setOverview] = useState<Overview | null>(null);
  const [waitlist, setWaitlist] = useState<WaitlistEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [newCode, setNewCode] = useState<{ code: string; role: InvitationRole; email?: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [newRole, setNewRole] = useState<InvitationRole>("listener");
  const [maxUses, setMaxUses] = useState("1");
  const [expiresInDays, setExpiresInDays] = useState("30");

  const refresh = useCallback(async () => {
    if (!token) return;
    const [list, entries] = await Promise.all([listAdminInvitations(token), listWaitlist(token)]);
    setOverview(list);
    setWaitlist(entries);
  }, [token]);

  useEffect(() => {
    if (!token || !allowed) return;
    refresh().catch((caught: unknown) => setError(messageOf(caught)));
  }, [token, allowed, refresh]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await work();
      await refresh();
    } catch (caught) {
      setError(messageOf(caught));
    } finally {
      setBusy(false);
    }
  };

  const create = (event: FormEvent) => {
    event.preventDefault();
    if (!token) return;
    void run(async () => {
      const created = await createAdminInvitation(token, {
        role: newRole,
        maxUses: Number(maxUses) || 1,
        expiresInDays: expiresInDays ? Number(expiresInDays) : undefined,
      });
      setCopied(false);
      setNewCode({ code: created.code, role: created.role });
    });
  };

  const copy = async () => {
    if (!newCode) return;
    try {
      await navigator.clipboard.writeText(newCode.code);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  const exportCsv = () => {
    const blob = new Blob([waitlistToCsv(waitlist)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "waiting-list.csv";
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!allowed) {
    return <p className={styles.note}>This page is for operators.</p>;
  }

  return (
    <div className={styles.page}>
      <header>
        <h1 className={styles.title}>Invitations</h1>
        {overview ? (
          <p className={styles.note}>
            Sign-up is {overview.mode === "invite" ? "by invitation" : "open to everyone"}. Founding artists:{" "}
            {overview.foundingArtists.used}
            {overview.foundingArtists.cap !== null ? ` of ${overview.foundingArtists.cap}` : " (no cap set)"}.
          </p>
        ) : null}
      </header>

      {error ? <p className={styles.error} role="alert">{error}</p> : null}

      <section className={styles.card} aria-labelledby="create-invitation">
        <h2 id="create-invitation" className={styles.heading}>Create a code</h2>
        <form className={styles.form} onSubmit={create}>
          <label>
            Role
            <select value={newRole} onChange={(event) => setNewRole(event.target.value as InvitationRole)}>
              <option value="listener">Listener</option>
              <option value="artist">Founding artist</option>
            </select>
          </label>
          <label>
            Uses
            <input type="number" min={1} max={500} value={maxUses} onChange={(event) => setMaxUses(event.target.value)} />
          </label>
          <label>
            Expires after (days)
            <input type="number" min={1} max={365} value={expiresInDays} onChange={(event) => setExpiresInDays(event.target.value)} />
          </label>
          <button type="submit" className={styles.primary} disabled={busy}>Create code</button>
        </form>
        {newCode ? (
          <div className={styles.code} role="status">
            <p>
              New {newCode.role === "artist" ? "founding-artist" : "listener"} code
              {newCode.email ? ` for ${newCode.email}` : ""}. It is shown only once: copy it now.
            </p>
            <div className={styles.codeRow}>
              <code>{newCode.code}</code>
              <button type="button" onClick={() => void copy()}>{copied ? "Copied" : "Copy"}</button>
            </div>
            <p className={styles.note}>A link that opens sign-up with the code filled in: add <code>?invite={newCode.code}</code> to the app address.</p>
          </div>
        ) : null}
      </section>

      <section className={styles.card} aria-labelledby="invitation-list">
        <h2 id="invitation-list" className={styles.heading}>Codes</h2>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Code</th><th>Role</th><th>Uses</th><th>Expires</th><th>From</th><th>State</th><th /></tr>
            </thead>
            <tbody>
              {(overview?.invitations ?? []).map((invitation: InvitationSummary) => (
                <tr key={invitation.id}>
                  <td><code>…{invitation.codeHint}</code></td>
                  <td>{invitation.role === "artist" ? "Founding artist" : "Listener"}</td>
                  <td>{invitation.useCount} / {invitation.maxUses}</td>
                  <td>{formatDate(invitation.expiresAt)}</td>
                  <td>{invitation.issuedBy === "artist" ? "An artist" : invitation.waitlistEntryId ? "Waiting list" : "Operator"}</td>
                  <td>{invitation.state}</td>
                  <td>
                    {invitation.state === "active" ? (
                      <button type="button" disabled={busy} onClick={() => token && void run(async () => { await revokeAdminInvitation(token, invitation.id); })}>
                        Revoke
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className={styles.card} aria-labelledby="waiting-list">
        <div className={styles.sectionHeader}>
          <h2 id="waiting-list" className={styles.heading}>Waiting list ({waitlist.length})</h2>
          <button type="button" onClick={exportCsv} disabled={waitlist.length === 0}>Export CSV</button>
        </div>
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr><th>Email</th><th>Joining as</th><th>Since</th><th>Invited</th><th /></tr>
            </thead>
            <tbody>
              {waitlist.map((entry) => (
                <tr key={entry.id}>
                  <td>{entry.email}</td>
                  <td>{entry.kind === "artist" ? "Artist" : "Listener"}</td>
                  <td>{formatDate(entry.createdAt)}</td>
                  <td>{entry.joined ? "Joined" : formatDate(entry.invitedAt)}</td>
                  <td className={styles.actions}>
                    {!entry.joined ? (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => token && void run(async () => {
                          const created = await inviteWaitlistEntry(token, entry.id);
                          setCopied(false);
                          setNewCode({ code: created.code, role: created.role, email: created.email });
                        })}
                      >
                        {entry.invitedAt ? "New code" : "Invite"}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => token && void run(async () => { await deleteWaitlistEntry(token, entry.id); })}
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export default function AdminInvitationsPage() {
  return (
    <AuthGate title="Sign in with an operator account to manage invitations.">
      <Invitations />
    </AuthGate>
  );
}
