# Vision Sprint 59: Clear for newcomers

**Status:** 🟡 Approved by the owner on 2026-11-25. Second of three sprints to
the invitation-only preview. Follows
[Sprint 58](2026-11-25-vision-sprint-58-safe-to-show.md), closed on
2026-11-25.
**Milestone:** [57](https://github.com/akoita/resonate/milestone/57), due
2026-12-09.
**Goal:** A person who has never used a wallet can sign up, listen, publish
and ask for help, and only invited people can get in.

## The road to the preview

The owner decided on 2026-11-25 that the next stage is a free,
invitation-only preview on the pre-production environment, and that work is
frozen to it. Opening a production environment is a separate stage, planned
and not scheduled (see "Production opening" below).

| Sprint | Theme | Due |
| --- | --- | --- |
| [58](2026-11-25-vision-sprint-58-safe-to-show.md) | Safe to show (closed 2026-11-25) | 2026-12-02 |
| 59 | Clear for newcomers (this sprint) | 2026-12-09 |
| [60](2026-12-10-vision-sprint-60-ready-to-show.md) | Ready to show | 2026-12-16 |

The dates are targets for the work, not a launch date.

**Freeze rule.** Until the preview is open, work is admitted only if it is in
one of these three sprints. The exceptions are security alerts, an incident,
and the marking of generated audio due on 2026-12-02 (Sprints 54 and 56).
Sprint 55 is paused. The purchase items of Sprint 56 (#2606 items 2 and 3)
wait, because buying is off in the preview.

## Why this theme

- **The preview is capped.** Registration is open to anyone in the code today.
- **The app speaks the language of wallets.** Sign-in is a passkey, and the
  wording and the navigation should say so.
- **The operator must be reachable, and must be able to reach people.** A
  plain report form, a support contact and an email address at sign-up.
- **Each founding artist's agreement and consent choices are on record.**

## Approved scope and order

| Order | Tier | Axis | Issue | Outcome |
| --- | --- | --- | --- | --- |
| 1 | P0 | New needs | [#2662](https://github.com/akoita/resonate/issues/2662) | Invitation-only registration, a cap on founding artists, and a waiting list |
| 2 | P0 | Usability | [#2663](https://github.com/akoita/resonate/issues/2663) | "Sign in" wording everywhere; about eight destinations for a listener; AI generation last; surfaces that are not ready are hidden |
| 3 | P0 | Known issue | [#2664](https://github.com/akoita/resonate/issues/2664) | A report and takedown form that needs no account and no stake |
| 4 | P0 | Known issue | [#2666](https://github.com/akoita/resonate/issues/2666) | The participation agreement and consent choices recorded per artist and per version |
| 5 | P1 | Usability | [#2665](https://github.com/akoita/resonate/issues/2665) | Email at sign-up, and three service emails |
| 6 | P1 | Known issue | [#2667](https://github.com/akoita/resonate/issues/2667) | Support contact and a service status notice |
| 7 | P2 | Business value | [#2668](https://github.com/akoita/resonate/issues/2668) | Stretch: Shows as an "I would come" signal with no money |

**Dependencies.** #2663 builds on #2658 (Sprint 58, merged). #2666 needs the
agreement text from the operator and ships with a marked placeholder until
then; the placeholder says that the text has not had a legal review. #2665
needs the email provider (deployment half). The others are
independent.

## Deployment halves

Tracked in `resonate-iac` (private):

- resonate-iac#284: email provider account and sending domain.
- The registration mode and cap for the preview environment.
- resonate-iac#309 and resonate-iac#307: rate limits that are per user and
  shared between instances, and the AI spend budget.

## Exit criteria

- In invitation mode, a new passkey without a valid code cannot create an
  account, and the artist cap holds (tests).
- No screen outside the wallet's own says "Connect your wallet". A new
  listener sees at most eight sidebar destinations. Accessibility and
  responsive checks pass.
- A signed-out visitor can file a notice from a release page; it reaches the
  admin queue and the uploader is told (tests).
- An artist cannot publish before accepting the current agreement version
  (test).
- The three service emails are sent once per event (tests).
- The User Guide and the feature pages describe what is built.

## Production opening (planned, not scheduled)

The work that only makes sense with a production environment is kept as its
own stage, with no date
([milestone 59](https://github.com/akoita/resonate/milestone/59)):

- [#2660](https://github.com/akoita/resonate/issues/2660): start-up guards
  that refuse development defaults in a production deployment, and a
  `config:check` script for the deploy pipeline. Deferred by the owner on
  2026-11-25, because the guards only act in production.
- [#1663](https://github.com/akoita/resonate/issues/1663): target
  configuration and cutover smoke against the production deployment.
- [#1667](https://github.com/akoita/resonate/issues/1667): the first
  protected software release, with its evidence.
- The deployment halves resonate-iac#339 (environment), resonate-iac#338
  (secrets and keys) and resonate-iac#340 (operations).

Nothing built in Sprints 58 to 60 is specific to the preview: the switches,
the renditions and the storage rules apply unchanged to a production
deployment.

## Not in this sprint

- Translating the app. French public pages are a later item (#838).
- Card pledges for Shows. #2668 involves no payment.
- Creating a production environment.
- Everything outside Sprints 58 to 60 (the freeze).

## Revenue line

Vision-neutral usability, trust and operations. #2668 is groundwork for
revenue line 1 (Shows) and charges nothing. No fee, split, price or payout
change, and artists keep at least 85% (ADR-BM-4).
