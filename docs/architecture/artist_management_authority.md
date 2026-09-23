---
title: "Artist and release management authority"
status: implemented
issues: ["https://github.com/akoita/resonate/issues/1762"]
---

# Artist and release management authority

## Identities and boundaries

An account authenticates a person. An `Artist` identifies a public or manager
profile. `ReleaseArtistCredit.artistId` identifies a credited artist;
`Release.artistId` retains the uploader's manager profile for compatibility.
Neither a credit, a matching display name, nor an upload establishes authority
over the credited profile.

Management authority is resource-specific. A profile manager can edit public
profile metadata. A release manager can read, rename, replace artwork, edit
track titles and explicit labels, or replace track audio on the exact managed
release within the granted scope. Track audio replacement requires its own
scope and is limited to unpublished releases. Track AI disclosures and other
protected corrections remain owner-only. Profile grants do not
inherit catalog access, and release grants do not extend to later uploads or
other releases credited to the same artist. Rights evidence, licensing,
pricing, payouts, and legal ownership have separate checks and do not follow a
management grant or transfer. An approved claim under #1492 is an operator-
reviewed grant to edit one public profile; it is not a management ownership
transfer.

| Actor or relationship | Profile metadata | Release inventory and metadata | Catalog media | Track audio | Delegate or transfer | Rights and money |
| --- | --- | --- | --- | --- | --- | --- |
| Legacy account linked by `Artist.userId` | Own profile, unless transferred | Releases whose `Release.artistId` points to that profile, unless transferred | Same releases, unless transferred | Same unpublished releases, unless transferred | Own resources only | Existing independent rules |
| Approved public-profile claimant | Claimed profile only | None by claim alone | None | None | None | None by claim |
| Active profile grant | Named profile with `PROFILE_EDIT` | None | None | None | None | None |
| Active release grant | None | Named release with `CATALOG_READ` or `CATALOG_METADATA`; `TRACK_METADATA` edits only track titles and explicit labels; editing also permits read | Named release with `CATALOG_MEDIA` | Named unpublished release with `TRACK_AUDIO` | None | None |
| Recipient after accepted transfer | Named profile, release, or release set | Only transferred releases | Only transferred releases | Only transferred releases, while unpublished | New management owner | Existing rights and money rules remain separate |
| Pending, declined, revoked, or expired grant | None | None | None | None | None | None |

The explicit `managementOwnerUserId` on a profile or release overrides the
legacy association. Null means the legacy association still supplies the
management owner; this avoids a destructive backfill. A transferred release
keeps `Release.artistId`, its artist credits, provenance, rights route, and
settlement identity. Every owner check for management operations must use the
same resolver so the former account cannot retain access through an old route.

## Delegation and transfer

Only the current management owner can invite a registered account. The invite
names a profile or release and its scopes, starts pending, and grants nothing
until the recipient accepts. Active grants are checked on every request and
stop working immediately when revoked or expired. A scope expansion requires
recipient acceptance. The owner may narrow an accepted grant or shorten its
expiry immediately. That change revokes the prior row and creates a new active
row with the reduced authority, retaining both records in resource history.
It also revokes pending invitations for the same manager and resource so an
older invitation cannot restore broader authority.
Replacing a grant through a fresh invitation also leaves its previous record
in history while the resource exists. Deleting a resource removes its grant
records; the transfer snapshot remains available for audit.
The recipient can decline or relinquish access. Private invite and audit data
are never returned by public artist or release reads.

A transfer starts pending with a snapshot of exactly one profile, selected
releases, or all releases currently managed by the proposer. The recipient
accepts or declines it. Acceptance rechecks the proposer still owns every
resource, then changes all selected management owners in one transaction.
If ownership changed or a selected resource disappeared, acceptance fails
without partial handoff. By default the former owner retains no management
access to transferred resources; pending and active manager invitations on
those resources are revoked so the new owner can issue fresh invitations.
Explicit unrelated rights and financial
authority is unaffected. Profile and catalog authority require separate
transfers when both are intended. Later uploads are not silently included in
an already accepted catalog snapshot.

Multiple people at a label or partner can each hold an explicit scoped grant.
An organization principal is a distinct future identity and must not be
simulated through a shared personal login. Until organization identities exist,
each individual accepts and uses their own grant, preserving an audit trail.

## Recovery after an accepted transfer

The original proposer may submit evidence that an accepted management transfer
should be reversed. A request changes no authority by itself. An admin or
operator reviews the evidence and records a decision and note; the recipient
cannot be displaced by a request alone. Rejected requests remain in the audit
history, and the proposer may submit new evidence if the transfer is still
eligible.

Approval is limited to the exact resources in the accepted transfer snapshot.
In one transaction it rechecks that the original recipient still manages every
resource and that no later accepted transfer touched any of them. If either
condition fails, approval stops without changing any owner. Otherwise it sets
the former proposer's explicit management-owner override on each resource,
revokes pending and active grants for those resources, and cancels pending
transfers that include them. The original accepted transfer and the reviewed
recovery request remain in the audit trail. Recovery changes neither credited
identity nor rights, legal ownership, licensing, payout, or settlement state.

Account erasure removes free-text recovery evidence and review notes, rejects
the erased requester's pending requests, and retains pseudonymous decision
history. A transfer that has since passed to another manager needs a new
management transfer or a separate operator investigation; it cannot be
reversed through the stale snapshot.

## Migration and verification

Existing profiles and releases need no owner rewrite: null overrides preserve
their current management owner. Existing approved claims remain profile-edit
only. Ambiguous credits remain unresolved; no migration joins identities by
name. Account closure must revoke or hand off pending and active management
relationships without restoring a prior owner through a null override.

Authorization tests must cover the current self-associated profile, a manager
editing a release credited to another artist, unrelated users, pending and
revoked grants, accepted transfers, and denial of the former owner. They must
also prove that profile claims and catalog grants do not authorize rights or
financial actions. API responses and the artist UI must show pending versus
active grants and distinguish a public credit from a manageable resource.

## Implemented management flows

The current implementation covers profile details, release inventory, release
title and artwork, track titles and explicit labels, invitation acceptance and
revocation, direct grant narrowing and expiry shortening, and profile or
catalog management transfers. Track audio replacement is implemented as a
separately scoped slice: owners and accepted `TRACK_AUDIO` managers can replace
audio on ready, unpublished releases. Versioned processing activates each
replacement atomically, keeps the current audio playable during processing, and
preserves historical stem references for existing purchases and saved remix
projects. See the [audio replacement design](track_audio_replacement.md) for
the request and activation contract. Pending grant and transfer invitations
are exposed through the authenticated, recipient-scoped
`GET /management/invitations/pending` read and shown in the
in-app notification bell. The client refreshes the list while signed in; an
invitation remains visible until it is accepted, declined, revoked, or expires.
This does not disclose invitations through the public wallet notification feed.
An original proposer can request operator-reviewed recovery of an accepted
transfer while the original recipient still manages the exact transferred
resources and no later accepted transfer has involved them. Approval restores
only the explicit management-owner override and ends existing grants and
pending transfers for those resources. The artist and operator surfaces show
the request and decision state. The authorization suite covers a release
credited to an artist other than its uploader, including scoped delegation,
claim-only profile access, and release management transfer.
