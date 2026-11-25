"use client";

import { useCallback, useEffect, useState } from "react";
import { createMyInvitation, getMyInvitations, type InvitationSummary } from "../../lib/api";
import { Button } from "../ui/Button";

type Props = { token: string | null | undefined };

type Mine = Awaited<ReturnType<typeof getMyInvitations>>;

/**
 * #2662: a founding artist can hand a few listener invitations to their fans.
 * Shown only to founding artists; each code is shown once, when it is made.
 */
export default function FoundingArtistInvitationsPanel({ token }: Props) {
  const [mine, setMine] = useState<Mine | null>(null);
  const [newCode, setNewCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!token) return;
    try {
      setMine(await getMyInvitations(token));
    } catch {
      setMine(null);
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  if (!mine?.eligible) return null;

  const create = async () => {
    if (!token) return;
    setBusy(true);
    setError(null);
    try {
      const created = await createMyInvitation(token);
      setNewCode(created.code);
      await load();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "The invitation could not be created.");
    } finally {
      setBusy(false);
    }
  };

  const describe = (invitation: InvitationSummary) =>
    invitation.state === "used" ? "Used" : invitation.state === "active" ? "Not used yet" : invitation.state === "expired" ? "Expired" : "Revoked";

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <h3 className="settings-section-title">Invite your listeners</h3>
          <p className="home-subtitle">
            As a founding artist you can invite {mine.allowance} listeners during the preview. Each code works once
            and expires after 30 days.
          </p>
        </div>
        <Button variant="primary" onClick={() => void create()} disabled={busy || mine.remaining === 0}>
          {mine.remaining === 0 ? "All invitations used" : busy ? "Creating…" : `Create an invitation (${mine.remaining} left)`}
        </Button>
      </div>
      {newCode ? (
        <p role="status">
          New code: <code>{newCode}</code>. Copy it now; it is shown only once.
        </p>
      ) : null}
      {error ? <p role="alert">{error}</p> : null}
      {mine.invitations.length > 0 ? (
        <ul>
          {mine.invitations.map((invitation) => (
            <li key={invitation.id}>
              <code>…{invitation.codeHint}</code> · {describe(invitation)}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
