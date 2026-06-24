# Update Available Prompt

**Status:** `implemented`
**Audience:** all signed-in and public users of the web app
**Surface:** global (every page of the Next.js frontend)

## What it does

With frequent daily deployments, a user can keep a tab open for hours running an
old build. This feature shows a small, non-intrusive snackbar — _"A new version
is available · Refresh"_ — once a newer build has been deployed, inviting the
user to reload and pick up the latest frontend.

It is the standard "new version available, please refresh" pattern many desktop
and web apps now use.

## How it works

1. **Each build gets a unique id.** A `prebuild` step
   (`web/scripts/write-build-version.mjs`) writes `web/src/lib/buildVersion.ts`
   with a unique-per-build identifier — the commit SHA when available (CI env or
   git), otherwise a build timestamp. The committed default is `"dev"`.
2. **The running client knows its own build id** (`BUILD_VERSION`, inlined at
   build time into the client bundle).
3. **A version endpoint reports the *live* build.** `GET /api/version` returns
   `{ version: BUILD_VERSION }` with `Cache-Control: no-store`, so it always
   reflects whichever build is currently serving requests.
4. **The client polls and compares.** `useUpdateAvailable` fetches `/api/version`
   on mount, every 60s, on tab focus, and when the connection returns. When the
   deployed version differs from the running build, `UpdateAvailablePrompt`
   appears.

After a deploy, every request (including from old tabs) is served by the new
revision, so an old client polling `/api/version` gets the new id and prompts.

## UX

- Persistent (does not auto-dismiss) — it waits for the user to act.
- **Refresh** reloads the page; **✕** dismisses it. If an even newer version
  ships after a dismiss, it re-appears.
- Bottom-centre, clear of the bottom-right toasts and the player bar.
- `role="status"` + `aria-live="polite"`; honors `prefers-reduced-motion`.
- Never shown for unbuilt/local-dev runs (`BUILD_VERSION === "dev"`).

## How to verify

- Locally it stays hidden (dev build id). To exercise it, temporarily change the
  committed `BUILD_VERSION` and have `/api/version` return a different value.
- On a deployed environment: load the app, deploy a new frontend build, and
  within ~60s (or on tab focus) the prompt appears. Click **Refresh** → the new
  build loads.
- Unit tests: `web/src/lib/updateAvailable.test.ts` covers the comparison rules
  and the `/api/version` contract.

## Code references

- `web/scripts/write-build-version.mjs` — build-time version generator (npm `prebuild`)
- `web/src/lib/buildVersion.ts` — generated build id (committed default `"dev"`)
- `web/src/lib/updateAvailable.ts` — pure comparison helper
- `web/src/app/api/version/route.ts` — `GET /api/version` (no-store)
- `web/src/hooks/useUpdateAvailable.ts` — polling hook
- `web/src/components/system/UpdateAvailablePrompt.tsx` — the snackbar (mounted in `web/src/app/layout.tsx`)
- `.update-prompt` styles in `web/src/app/globals.css`
