---
title: "Show Attendance Credential Boundaries"
status: draft
owner: "@akoita"
related:
  - community-membership-boundaries.md
  - public-supporter-collector-credential-rules.md
  - ../features/listener_community_network.md
  - ../features/resonate_shows.md
  - ../features/shows_campaign_rooms_plan.md
  - https://github.com/akoita/resonate/issues/1098
  - https://github.com/akoita/resonate/issues/1110
  - https://github.com/akoita/resonate/issues/1111
  - https://github.com/akoita/resonate/issues/1112
---

# Show Attendance Credential Boundaries

## Purpose

This RFC defines the product and privacy boundary for show attendance
credentials before any app, API, partner, or NFT implementation starts. It
extends the blockchain boundary from
[Blockchain-Native Community Membership Boundaries](community-membership-boundaries.md)
and the public credential rules from
[Public Supporter And Collector Credential Rules](public-supporter-collector-credential-rules.md).

Attendance is more sensitive than generic supporter or collector status because
it can reveal where a listener was, when they were there, and which local scene
or community they might belong to. Resonate can use attendance as a powerful
music-native social object, but only when the listener opts in and location
privacy remains explicit.

## Recommendation

Do not mint a new NFT-backed show attendance credential yet.

The recommended first path is:

1. treat show attendance as event-scoped proof, not city-scene membership;
2. create off-chain, revocable attendance badges first;
3. keep attendance hidden by default;
4. require explicit listener opt-in before any attendance appears on a public
   profile, partner verifier, reward, or external integration;
5. use confirmed attendance, fulfilled ticket/pledge state, guest-list
   confirmation, or operator grant as proof inputs;
6. pilot one post-show reward or artist-community status use case through a
   backend verifier before considering portable NFT credentials;
7. revisit an NFT-backed attendance credential only after recovery, revocation,
   metadata, venue safety, and partner demand are proven.

This keeps the useful part of attendance proof, namely event-scoped recognition
and rewards, without creating permanent public location history.

## Selected First User Story

The first user story should be **post-show artist rewards and community
recognition**, not broad public location proof.

Example:

> A listener who attended a Resonate-backed show can opt in to show an
> "Attended Artist - Paris 2026" badge, unlock a post-show drop or artist room
> prompt, and prove eligibility to a Resonate verifier without revealing exact
> ticket price, wallet address, check-in source, private room membership, or
> city-scene cohort membership.

This user story is worth solving because it is directly tied to artist value
and listener memory. It is narrower and safer than a venue-wide or
location-history credential, and it can be implemented off-chain first.

Deferred user stories:

- venue-wide loyalty programs;
- local ambassador credentials;
- partner perks that require broad venue history;
- NFT-backed public attendance collectibles;
- any credential that implies private city-scene membership.

## Decision Summary

| Question | Rule |
| --- | --- |
| First attendance path | Off-chain opt-in badge backed by event-scoped attendance proof. |
| First product use case | Post-show reward or artist community recognition. |
| New NFT-backed credential | Deferred until a pilot proves portability demand. |
| Transferability | Off-chain attendance badges are non-transferable. Future NFT attendance proof should default to non-transferable, revocable, or replacement-capable. |
| Expiry | Access perks should expire; optional memory/display badges can remain historical only after opt-in and lifecycle safety checks. |
| Revocation | Required for refunds, cancellations, no-shows, invalid check-ins, moderation, fraud, policy, and listener opt-out. |
| Public display | Requires explicit opt-in separate from pledge, ticket, check-in, city demand join, or room membership. |
| Public metadata | Event-scoped and minimal: artist/show label, coarse event geography if safe, approved date granularity, status, timestamps, proof method category. |
| Private data | Never publish raw location source, GPS/IP data, ticket price, pledge amount, wallet address, seat/order data, private room membership, city-scene cohort membership, refund/dispute/moderation state, or raw eligibility rules. |
| City scenes | Attendance can unlock event-specific access without exposing or creating city-scene cohort membership. |

## Credential Models

### Phase 1: Off-Chain Attendance Badge

Use this model first.

- Stored by Resonate as product state.
- Backed by event-scoped proof.
- Hidden by default.
- Public only after explicit opt-in.
- Non-transferable.
- Revocable immediately.
- Safe for profile display, reward eligibility, and partner verification.
- Does not require public token metadata or wallet-level identity.

Proof inputs can include:

- confirmed check-in;
- fulfilled ticket or pledge state;
- confirmed guest-list entry;
- artist/operator grant;
- verified partner import with reviewed privacy terms.

This model supports fast learning while preserving deletion, hide, moderation,
and lifecycle semantics.

### Phase 2: Attendance Verifier

Use a backend verifier after opt-in display rules exist.

The verifier should answer a narrow question:

> Does this public profile or authorized partner session currently have an
> active, opted-in attendance credential for this event or artist-defined
> reward rule?

It must not expose the listener's full show history, city-scene memberships,
wallet address, ticket details, or raw check-in data.

### Phase 3: NFT-Backed Attendance Credential

Defer until there is a concrete external use case where portable proof is the
product value.

Acceptable future candidates:

- opt-in commemorative attendance proof for a public show;
- artist-issued post-tour participation credential;
- partner reward credential that needs open wallet-native verification;
- contributor or crew credential where public attribution is the user goal.

Do not mint an NFT-backed attendance credential for:

- private city-scene cohorts;
- private attendee rooms;
- raw venue visit history;
- exact check-in times;
- ticket purchase amounts;
- no-show, refund, dispute, moderation, ban, or appeal state;
- minors, private events, or sensitive venues without a separate policy review.

## Transferability Rules

| Surface | Transfer Rule | Reason |
| --- | --- | --- |
| Off-chain attendance badge | Non-transferable | It recognizes a listener's event participation, not a market asset. |
| Post-show reward access | Non-transferable and time-boxed | Rewards should follow current eligibility and opt-in. |
| Artist community status | Non-transferable and revocable | Moderation and lifecycle state must override proof. |
| Future commemorative NFT | Prefer non-transferable or replacement-capable | Attendance is personal, and recovery/mistake handling matters. |
| Future partner perk token | Case-by-case, but default non-transferable or expiring | Avoid resale markets around location-derived social proof. |

Transfer of a ticket, pledge, wallet, or NFT must never automatically transfer
off-chain messages, room membership, moderation state, public profile display,
or partner roles.

## Expiry And Revocation Rules

Every attendance credential path must define expiry and revocation before
launch.

Revocation triggers:

- listener disables public attendance display;
- listener disconnects a partner integration;
- event is cancelled before attendance can be valid;
- ticket or pledge is refunded, failed, charged back, or invalidated;
- no-show status overrides ticket purchase;
- duplicate, fraudulent, or mistaken check-in is invalidated;
- delayed check-in misses the accepted confirmation window;
- artist/operator removes a manual grant;
- moderation ban/removal blocks community access;
- policy or safety review invalidates public display or reward eligibility.

Expiry rules:

- reward access should expire or refresh from current eligibility;
- venue or partner perks should be time-boxed;
- artist community prompts can expire after the post-show period;
- public memory badges can remain historical only after explicit opt-in and
  only when the event lifecycle is safe to display;
- revoked or expired credentials should expose no detail publicly unless the
  user previously opted into a public historical badge and the final API design
  intentionally allows minimal status.

## Lifecycle Edge Cases

Attendance proof must handle these cases before implementation:

| Edge Case | Product Rule |
| --- | --- |
| Event cancelled before doors | No attendance credential; any planned reward access fails closed. |
| Event postponed or rescheduled | Hold proof pending; display only after final attended event is confirmed. |
| Event cancelled after partial attendance | Treat as policy-dependent; default to hidden until operator confirms safe public copy. |
| Refund before show | No attendance credential. |
| Refund after attendance | Reward/display depends on final refund policy; avoid public status until reconciled. |
| Chargeback or fraud review | Revoke or hide pending review. |
| No-show | No attendance credential, even if the listener had a ticket or pledge. |
| Late check-in | Allow only inside an explicit confirmation window; otherwise manual review. |
| Guest list | Valid only after host/operator confirmation; public display still requires listener opt-in. |
| Ticket transfer | Attendance follows confirmed attendee/check-in, not original buyer by default. |
| Multiple tickets from one buyer | Do not infer all guests from buyer identity; each public badge needs a subject. |
| Private or invite-only event | Default no public credential unless event policy explicitly allows it. |
| Minor or sensitive venue | Require separate policy review before any public badge or verifier. |
| Moderation removal | Remove access even when attendance proof remains true. |
| Profile deletion/privacy downgrade | Remove public display and partner verification. |

## Public Metadata Boundary

Phase 1 should expose a backend/public verifier schema, not on-chain metadata.

Draft schema:

```json
{
  "schemaVersion": "show-attendance-credential/v1",
  "credentialId": "cred_...",
  "credentialType": "show_attendee",
  "displayLabel": "Show attendee",
  "subjectProfileId": "public-profile-id-or-null",
  "artistId": "artist-id-or-null",
  "artistDisplayName": "Artist Name",
  "showId": "show-or-campaign-id",
  "showLabel": "Artist in Paris",
  "eventDate": "2026-06",
  "eventGeo": {
    "country": "FR",
    "region": "Ile-de-France",
    "city": "Paris"
  },
  "status": "active | expired | revoked",
  "visibility": "public_profile | partner_verifier",
  "issuedAt": "2026-06-07T00:00:00.000Z",
  "updatedAt": "2026-06-07T00:00:00.000Z",
  "expiresAt": "2026-12-31T23:59:59.000Z",
  "proofMethod": "confirmed_check_in | fulfilled_ticket | campaign_pledge | guest_list | manual_grant",
  "verificationPath": "/community/credentials/cred_..."
}
```

Allowed public fields:

- credential id that is not a wallet address;
- credential type;
- display label;
- artist or show reference;
- coarse event geography when the event is public and the listener opted in;
- approved date granularity, preferably month/year or event date only when
  product policy allows exact display;
- active/expired/revoked status when safe;
- issue/update/expiry timestamps;
- proof method category;
- public profile id only when the listener profile is public.

Forbidden public fields:

- wallet address unless the user explicitly performs wallet-level verification
  for that partner session;
- email, internal user id, auth id, or private profile id;
- raw GPS, IP, device, scan, or check-in source data;
- exact seat, order, ticket, claim, or purchase record;
- ticket price, pledge amount, resale price, refund amount, or payment details;
- full attendance history;
- city-scene cohort membership;
- private show/campaign room membership;
- exact guest-list relationship or guest sponsor;
- refund, chargeback, dispute, moderation, report, ban, appeal, or operator
  note details;
- raw eligibility policy JSON.

If a future on-chain metadata schema is proposed, it must be a separate RFC or
implementation plan. It must preserve the same allowed/forbidden split and add
a stronger location-safety review.

## Opt-In And Visibility Rules

Attendance and attendance display are separate states.

Required controls:

- buying a ticket, pledging to a show campaign, joining a city demand group, or
  checking in does not make attendance public;
- public profile display requires explicit opt-in per badge or badge class;
- external verification requires explicit partner connection or one-time
  authorization;
- disabling public display removes attendance from public profile responses;
- disconnecting a partner stops future reward/role sync;
- private and follower/community-only profile modes do not create public
  attendance pages;
- disabling city-scene matching does not erase confirmed attendance proof, but
  it must prevent city-scene cohort exposure and location-derived matching.

Recommended default copy:

- "Show this attendance badge on my public profile";
- "Let this artist verify my attendance for post-show rewards";
- "This does not reveal your wallet address, ticket price, exact check-in
  source, or city-scene cohort membership."

Avoid copy that implies surveillance, ranking, financial return, or public
movement history.

## City-Scene Boundary

Attendance can unlock event-specific access without exposing city-scene cohort
membership.

Rules:

- an attendance credential is scoped to an event or artist reward rule, not a
  city cohort;
- city demand room joins and city-scene cohort membership remain off-chain;
- public badge/verifier responses must not say "member of Paris scene" or
  expose cohort ids;
- aggregate city analytics can count attendance only through privacy-safe,
  thresholded reporting;
- venue or local partner verification must request event-specific proof rather
  than broad city-scene membership.

This preserves the useful signal for Shows and rewards while preventing a
public location-derived social graph.

## Privacy And Moderation Rules

Public attendance credentials must not weaken listener safety.

Rules:

- moderation bans/removals override attendance-based room, reward, and partner
  access;
- public credential pages must not expose reports, bans, removals, appeals, or
  safety reviews;
- partner verification should fail closed when eligibility cannot be verified;
- private events, minors, sensitive venues, and safety incidents need stricter
  event policies before display;
- profile deletion or privacy downgrade removes public display;
- artists/operators need a way to revoke manual grants without altering raw
  attendance records;
- attendance should be treated as recognition and reward eligibility, not as an
  entitlement to message, bypass bans, or avoid moderation.

## Account Recovery Rules

Phase 1 off-chain attendance badges:

- follow the Resonate account;
- can re-evaluate eligibility after wallet recovery or wallet replacement;
- can preserve public display if the recovered account still satisfies the
  proof rule and the listener keeps the opt-in;
- should not publish old wallet addresses, ticket order ids, or payment
  identifiers as credential identity.

Future non-transferable NFT attendance proof:

- blocked until recovery semantics are designed;
- needs replacement, burn/reissue, delegation, or account-abstraction recovery
  semantics;
- must define who can revoke, reissue, or annotate a credential and what audit
  trail exists.

## External Use Case Priority

Recommended order:

1. **Post-show artist rewards** because they create direct artist/listener value
   without broad location disclosure.
2. **Artist community recognition** because it can use existing off-chain room
   and profile visibility controls.
3. **Artist-site verification** once the verifier API is stable.
4. **Venue or partner perks** only after expiry, revocation, fraud handling,
   sensitive-venue policy, and support operations are proven.
5. **Agent tooling** after stable schemas and consent receipts exist.
6. **New NFT-backed attendance credential** only after one of the above proves
   that open, wallet-native portability is the product value.

## Implementation Follow-Ups

This RFC recommends documentation and product rules only. It does not implement
schemas, APIs, profile display, verifier endpoints, partner integrations, or
contracts.

Recommended follow-up issues:

1. [#1110](https://github.com/akoita/resonate/issues/1110): off-chain opt-in
   show attendance badge controls;
2. [#1111](https://github.com/akoita/resonate/issues/1111): privacy-safe show
   attendance verifier API;
3. [#1112](https://github.com/akoita/resonate/issues/1112): post-show rewards
   pilot from opted-in attendance proof;
4. account-recovery rules for future non-transferable attendance credentials;
5. future NFT-backed attendance credential contract RFC only after the pilot
   proves need.

## Non-Goals

- No Solidity implementation.
- No Prisma schema migration.
- No backend endpoint implementation.
- No frontend badge UI implementation.
- No venue, Discord, or partner integration implementation.
- No new deploy variables or contract addresses.
- No conversion of city-scene cohorts, city demand rooms, or private attendance
  history to on-chain state.
