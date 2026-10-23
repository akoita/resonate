# Vision Sprint 35: Seeing who's here, and reaching them

**Status:** Closed 2026-10-23. All six issues are closed. Real email delivery
on staging waits on the deployment half,
[resonate-iac#284](https://github.com/akoita/resonate-iac/issues/284).
**Milestone:** [37](https://github.com/akoita/resonate/milestone/37).
**Goal:** Before a real cohort, the operator can see who signed up and who is
active without querying the database, and people can get important notices by
email without signing in.

## Why this theme

Sprint 34 gave the platform a voice in the app, but two gaps remain before real
users arrive:

- **The operator can't see who's using the app.** `User` stores only
  `createdAt`, the account page looks up one exact id, and product analytics
  cover only users who consented.
- **People who don't sign in hear nothing.** Notices, refund reminders and
  account actions are in-app only. The owner decided on 2026-10-16 (#2148) to
  send them by email too, to an optional, confirmed contact address.

Both sit on the
[#1595](https://github.com/akoita/resonate/issues/1595) readiness ledger.

## Approved scope and order

| Order | Axis | Issue | Outcome |
| --- | --- | --- | --- |
| 1 | Business value | [#2166](https://github.com/akoita/resonate/issues/2166) | Operators list, search, filter and open users at `/admin/users`. Last sign-in and last activity are recorded with bounded writes, exported, and erased. Detail views are audited |
| 2 | Usability | [#2169](https://github.com/akoita/resonate/issues/2169) | An optional contact address with double opt-in and per-category preferences. Notices go out by email through a provider-neutral transport, idempotently, with a verified bounce webhook |
| 3 | Known issue | [#2144](https://github.com/akoita/resonate/issues/2144) (parts 2 and 3) | Paid agent and MCP stem downloads count in payout analytics, without double-counting contract sales. The unused helper is removed |
| 4 | New needs | [#1890](https://github.com/akoita/resonate/issues/1890) | A recorded decision on stricter request validation (`whitelist`, `transform`, interface-typed bodies), applied where safe, with tests |

Dependencies:

- #2166 builds on #2147 (suspension controls) and #2146 (notice counts), both
  merged.
- #2169 builds on #2146 and the #2148 decision. It also adds the confirmed
  contact address to #2166's user search.
- #2169's deployment half, resonate-iac#284, waits on the application's
  variable names and on the owner's provider choice. Only the application
  half counts toward this sprint.
- #2144 part 2 builds on #1894, and #1890 builds on #1888; both are closed.

## Exit criteria

- On staging, an operator can find any user and open their detail without a
  database query; non-admin callers get 403.
- Email notices are merged with tests through the development transport:
  - double opt-in;
  - exactly one email per notice;
  - category opt-outs;
  - export and erasure.

  Real delivery on staging counts once resonate-iac#284 is done.
- #2144 parts 2 and 3 and #1890 are merged with tests.
- Help articles, the privacy policy, the feature docs and
  `docs/deployment/environment.md` describe what is built.

## Not in this sprint

- **Deferred to their own issues:**
  - the artist's net received per sale (#2172, split from #2144);
  - admin hardening: step-up passkey confirmation and a durable admin audit
    log (#2173).
- **Excluded:**
  - contract changes (#1759);
  - legal or regulatory answers (#1774, #1776);
  - official stems (#1976);
  - Crate Digger auto-buy (#2027);
  - Listener Pro;
  - the paused Remix Studio items.
- **Not counted:** the owner-signed staging checks (#2154) and the rekordbox
  check (#2121) remain the owner's.

## Revenue line

Vision-neutral readiness (ADR-BM-6); #2144 is reporting for Line 3 and x402. No
fee, split or payout change; artists keep at least 85% (ADR-BM-4).
