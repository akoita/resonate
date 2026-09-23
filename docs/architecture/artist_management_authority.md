---
title: "Artist and release management authority"
status: in-progress
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
profile metadata. A release manager can read, rename, replace artwork, or edit
track titles and explicit labels on the exact managed release within the granted
scope. Track AI disclosures and other
protected corrections remain owner-only. Profile grants do not
inherit catalog access, and release grants do not extend to later uploads or
other releases credited to the same artist. Rights evidence, licensing,
pricing, payouts, and legal ownership have separate checks and do not follow a
management grant or transfer. An approved claim under #1492 is an operator-
reviewed grant to edit one public profile; it is not a management ownership
transfer.

| Actor or relationship | Profile metadata | Release inventory and metadata | Catalog media | Delegate or transfer | Rights and money |
| --- | --- | --- | --- | --- | --- |
| Legacy account linked by `Artist.userId` | Own profile, unless transferred | Releases whose `Release.artistId` points to that profile, unless transferred | Same releases, unless transferred | Own resources only | Existing independent rules |
| Approved public-profile claimant | Claimed profile only | None by claim alone | None | None | None by claim |
| Active profile grant | Named profile with `PROFILE_EDIT` | None | None | None | None |
| Active release grant | None | Named release with `CATALOG_READ` or `CATALOG_METADATA`; `TRACK_METADATA` edits only track titles and explicit labels; editing also permits read | Named release with `CATALOG_MEDIA` | None | None |
| Recipient after accepted transfer | Named profile, release, or release set | Only transferred releases | Only transferred releases | New management owner | Existing rights and money rules remain separate |
| Pending, declined, revoked, or expired grant | None | None | None | None | None |

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

## Remaining scope in #1762

The current implementation covers profile details, release inventory, release
title and artwork, track titles and explicit labels, invitation acceptance and
revocation, direct grant narrowing and expiry shortening, and profile or
catalog management transfers. Track audio replacement still needs a versioned
processing path and a dedicated scope and UI; it must
remain unavailable for published releases and preserve existing purchases and
remix references. Owners can widen a manager's scopes or extend an expiry
through a fresh invite. Invite notifications and transfer recovery remain
to be designed and delivered.
Keep #1762 open until those workflows and their denied-access tests are
explicitly completed or separately tracked.
