# Resonate Desktop

Native desktop shell for the existing Resonate web experience.

This package intentionally does not fork product screens. Electron loads the
same Next.js app that lives in `web/`, while the shell owns native windowing,
external-link handling, download save prompts, and future desktop adapters.

## Local Development

Install dependencies once:

```bash
nvm use 22
npm install -g npm@11.14.1
cd web && npm ci --legacy-peer-deps
cd ../desktop && npm ci
```

Run the desktop app against the local web dev server:

```bash
cd desktop
npm run dev
```

By default, `npm run dev` starts `web/` on `http://localhost:3001`, waits for
it, then opens Electron.

To use an already-running web app:

```bash
cd desktop
RESONATE_DESKTOP_START_WEB=false \
RESONATE_DESKTOP_WEB_URL=http://localhost:3001 \
npm run dev
```

## Packaging

Smoke-package the app without creating installers:

```bash
cd desktop
npm run package:dir
```

Platform-specific build commands:

```bash
npm run dist:win
npm run dist:mac
npm run dist:linux
```

Windows is the first supported QA target. macOS and Linux share the same shell
configuration, but signing/notarization and release-channel automation still
need final release work before public distribution.

## Configuration

| Variable | Purpose |
| --- | --- |
| `RESONATE_DESKTOP_WEB_URL` | Absolute URL loaded inside the shell. Defaults to `http://localhost:3001` for local development. |
| `RESONATE_DESKTOP_START_WEB` | Set to `false` to skip starting `web/` from `npm run dev`. |
| `RESONATE_DESKTOP_ALLOWED_ORIGINS` | Comma-separated extra origins allowed to remain in-app. Other links open in the system browser. |
| `RESONATE_DESKTOP_DEVTOOLS` | Set to `true` to open Chromium DevTools on launch. |

Frontend API, wallet, RPC, and chain configuration remains owned by `web/`
through the existing `NEXT_PUBLIC_*` variables. The desktop package should not
duplicate those values.

## Native Behavior

- File inputs and drag/drop use Chromium native behavior.
- Downloads prompt for a save location before writing to disk.
- External links open in the system browser unless their origin is explicitly
  allowed.
- `window.resonateDesktop` exposes a tiny runtime bridge for future adapters:
  `getRuntime()` and `selectAudioFiles()`.
