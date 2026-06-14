---
title: "Graceful Client Session Reset"
status: implemented
owner: "@akoita"
---

# Graceful Client Session Reset

## Status

`implemented` (#1199). Precursor to full server-side state migration (#915).

## Who It Is For

- **Users** who return after a deploy or environment change and would
  otherwise hit silent failures with no idea what to do.
- **Developers/operators** who need a clean, discoverable reset instead of
  telling people to "open devtools and clear localStorage".

## Value

When the frontend is pointed at a new backend build — or, more disruptively, a
new/reset backend environment with a fresh database (#915) — the browser holds
state that no longer applies: the JWT, the smart-account/auth addresses, known
addresses, and local library/AI-session keys. Previously a stale token just
produced cryptic 401s. This feature detects the situation and guides the user
through a safe reset, doing the safe parts automatically and explaining the
parts it cannot touch.

## How It Works

`GET /health` returns `{ status, appVersion, environmentId, dataEpoch }`. The
client stores the last stamp it saw and re-checks on load, window focus, and
after an auth-invalidation event:

- **`environmentId` or `dataEpoch` changed** → the app is talking to a new or
  reset environment → a **guided session-reset dialog**.
- **`appVersion` changed** (same environment) → a non-destructive **"a new
  version is available — reload"** banner.
- A failed `/health` is treated as **no change** — a transient network blip
  never nags the user.

The guided reset clears only app-owned `localStorage` keys (token, addresses,
known addresses, AI session, the env stamp), signs the user out, and reloads.
There is no service worker or IndexedDB, so a reload after the clear is
sufficient; an optional hard-refresh hint is offered for the rare stuck case.

### Passkey safety (deliberate)

The dialog copy is explicit that **the passkey is never deleted** and still
controls any account it created — the user simply signs in again. Passkeys
live in the platform authenticator and may control real smart accounts; the
app cannot and must not delete them, and never instructs the user to.

## How To Use

- **As a user:** when the dialog appears after an update, click **Reset and
  continue**. To reset manually any time, go to **Settings → Troubleshooting →
  Reset local session**.
- **As an operator (a new/reset environment):** set a distinct
  `RESONATE_ENVIRONMENT_ID` (or bump `RESONATE_DATA_EPOCH` for an in-place data
  reset). Every browser pointed at it gets the guided reset on next load. Set
  `APP_VERSION` at deploy for version-skew banners.

## Surfaces, Env Vars, Code

- API: `GET /health` (public) — `backend/src/modules/health/health.controller.ts`
- Env vars: `RESONATE_ENVIRONMENT_ID`, `RESONATE_DATA_EPOCH`, `APP_VERSION`
  (see `docs/deployment/environment.md`)
- Frontend: `web/src/lib/appEnvironment.ts` (detection),
  `web/src/lib/authSession.ts` (`resetLocalAppState`),
  `web/src/components/system/AppStateGuard.tsx`,
  `web/src/components/system/SessionResetDialog.tsx`,
  Settings → Troubleshooting
- Tests: `web/src/lib/appEnvironment.test.ts`,
  `web/src/lib/authSession.test.ts`,
  `backend/src/tests/health.integration.spec.ts`

## Out Of Scope

- Server-side **state migration** between environments (#915) — this feature
  only handles the *client* gracefully when the server is new/reset.
- Recovering a user's data across environments.

## References

- Issue: [#1199](https://github.com/akoita/resonate/issues/1199)
- State migration: [#915](https://github.com/akoita/resonate/issues/915)
