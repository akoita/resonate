# Invitation-Only Sign-Up

**Status:** implemented (#2662)
**Audience:** listeners, artists, operators

## What it does

Registration can run in one of two modes, set by `REGISTRATION_MODE`:

- `open` (the default): any new passkey creates an account, as before.
- `invite`: a new account needs a valid invitation code. Signing in to an
  existing account works the same in both modes.

The mode is decided by the server at sign-in. The web app asks the server
which mode it is in and, in invitation mode, opens a sign-up dialog that
checks a code before the passkey prompt.

## Invitations

- A code is twelve characters (`XXXX-XXXX-XXXX`), shown once when it is made.
  Only a hash is stored, with the last four characters as a hint.
- Each code has a role (`listener` or `artist`), a number of uses and an
  optional expiry. Operators create, list and revoke codes at
  `/admin/invitations`; every action is in the admin audit log, without the
  code.
- A link with `?invite=<code>` opens the sign-up dialog with the code filled
  in.
- Code checks and redemptions are rate limited, so codes cannot be guessed.
  A revoked and an unknown code get the same answer.

## Founding artists and the cap

- Redeeming an `artist` code makes the account a founding artist. In
  invitation mode only founding artists (and operators) can set up an artist
  profile; an existing listener account enters an artist code on
  `/artist/onboarding`.
- `FOUNDING_ARTIST_CAP` caps the founding-artist places. Places are counted
  when a code is used, under a lock, so two people cannot both take the last
  one. When the cap is reached, artist codes are refused with a plain message
  and the waiting list is offered.
- Each founding artist can create `FOUNDING_ARTIST_LISTENER_INVITES` listener
  codes (default 3) from Settings → Artist. Each works once and expires after
  30 days.

## Waiting list

- A person without a code leaves an email address and whether they are a
  listener or an artist, and agrees to be written to about their invitation.
  The consent wording version and date are stored.
- The form answers the same whether or not the address was already listed.
- Operators see the list at `/admin/invitations`, export it as CSV, make a
  single-use code for an entry (to send themselves), or remove an entry on
  request.
- When the code made for an entry is used, the entry is linked to the new
  account, so it is included in that account's data export and deleted by
  account erasure.

## Sign-in answers

`POST /auth/verify` answers a refused registration with one of
`invite_required`, `invite_invalid`, `invite_expired`, `invite_used` or
`invite_artist_cap_reached`. A use of a code is counted before the account is
created and given back if creating it fails.

## Routes

| Route | Who |
| --- | --- |
| `GET /auth/registration` | anyone: mode, whether the artist cap is reached |
| `POST /auth/invitations/check` | anyone, rate limited: a read-only code check |
| `POST /waitlist` | anyone, rate limited |
| `POST /invitations/redeem` | signed in: use an artist code on an existing account |
| `GET`/`POST /invitations/mine` | signed in: a founding artist's own listener codes |
| `GET`/`POST /admin/invitations`, `POST /admin/invitations/:id/revoke` | admin, operator |
| `GET /admin/waitlist`, `POST /admin/waitlist/:id/invite`, `DELETE /admin/waitlist/:id` | admin, operator |

## Privacy

`Invitation`, `InvitationRedemption` and `WaitlistEntry` are in the personal
data export (the code hash is redacted). Erasure deletes waiting-list entries
and keeps invitations and redemptions, which hold no free text and follow the
rotated account id.

## Business model

Vision-neutral infrastructure. No fee, split, price or payout change.

## Tests

- `backend/src/tests/invitations.integration.spec.ts`: single use, expiry,
  revocation, simultaneous use, giving a use back, the cap, the artist
  profile rule, the founding-artist allowance, the waiting list.
- `backend/src/tests/auth.controller.spec.ts`: the sign-in door in
  invitation mode.
- `backend/src/tests/invitations.controller.http.spec.ts`: route access,
  validation and the audit record.
