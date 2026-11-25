# Vision Sprint 59: Clear for newcomers

**Status:** 🟡 Approved by the owner on 2026-11-25. Second of three sprints to
the first production version. Starts when
[Sprint 58](2026-11-26-vision-sprint-58-safe-to-open.md) closes.
**Milestone:** [57](https://github.com/akoita/resonate/milestone/57), due
2026-12-09.
**Goal:** A person who has never used a wallet can sign up, listen, publish
and ask for help, and only invited people can get in.

## Why this theme

- **The pilot is capped.** Registration is open to anyone in the code today.
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

**Dependencies.** #2663 needs #2658 (Sprint 58) merged. #2666 needs the
agreement text from the operator and ships with a marked placeholder until
then. #2665 needs the email provider (deployment half). The others are
independent.

## Deployment halves

Tracked in `resonate-iac` (private):

- resonate-iac#284: email provider account and sending domain.
- resonate-iac#339: registration mode and cap for production.
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

## Not in this sprint

- Translating the app. French public pages are a later item (#838).
- Card pledges for Shows. #2668 involves no payment.
- Everything outside Sprints 58 to 60 (the freeze).

## Revenue line

Vision-neutral usability, trust and operations. #2668 is groundwork for
revenue line 1 (Shows) and charges nothing. No fee, split, price or payout
change, and artists keep at least 85% (ADR-BM-4).
