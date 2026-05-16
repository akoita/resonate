# Desktop App

Status: `partial`

## Audience

- listeners who want Resonate as a native desktop music app
- artists uploading and managing releases from a desktop environment
- developers validating packaged app behavior before release

## Value

The desktop app reuses the existing `web/` experience inside a native shell,
giving Resonate a path to Windows, macOS, and Linux packaging without forking
product screens.

## Current Capability

- Root-level `desktop/` package using Electron and electron-builder
- local development against the existing Next.js app
- environment-driven shell URL configuration
- external navigation opens in the system browser
- downloads prompt for a save location
- narrow preload bridge for runtime detection and future native file picker
  adapters
- packaging scripts for Windows, macOS, and Linux targets

## How To Use

```bash
cd web && npm ci --legacy-peer-deps
cd ../desktop && npm ci
npm run dev
```

Build a local unpacked app:

```bash
cd desktop
npm run package:dir
```

## Configuration

Desktop-specific environment variables:

- `RESONATE_DESKTOP_WEB_URL`
- `RESONATE_DESKTOP_START_WEB`
- `RESONATE_DESKTOP_ALLOWED_ORIGINS`
- `RESONATE_DESKTOP_DEVTOOLS`

Frontend API, wallet, chain, RPC, and x402 values still come from the existing
`web/` environment variables.

## Verification

```bash
cd desktop
npm run lint
npm run package:dir
```

Use the manual checklist in `docs/qa/desktop_app_checklist.md` for OS QA.

## Related

- [Desktop app architecture](../architecture/desktop_app.md)
- [Desktop app QA checklist](../qa/desktop_app_checklist.md)
- [Environment variables](../deployment/environment.md)
- [Issue #781](https://github.com/akoita/resonate/issues/781)
