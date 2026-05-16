# Desktop App Architecture

Issue: [#781](https://github.com/akoita/resonate/issues/781)

## Decision

Use Electron for the first Resonate desktop shell.

Electron is heavier than Tauri, but it is the lowest-risk path for this repo
right now because Resonate already ships a complex Next.js app with wallet,
media, upload, and browser APIs. Electron lets the desktop app reuse that
experience with minimal product forking and without adding Rust or native
toolchain requirements to the default contributor path.

Tauri remains a good future candidate if binary size and a stricter native
security model become more important than packaging velocity.

## Loading Model

The initial desktop shell loads a configured web origin:

- local development defaults to `http://localhost:3001`
- `desktop/npm run dev` can start the existing `web/` Next dev server
- packaged builds can point to an approved deployed web origin with
  `RESONATE_DESKTOP_WEB_URL`
- packaging scripts write `desktop/generated/runtime-config.json` from the
  current `RESONATE_DESKTOP_*` values so unpacked apps and installers can be
  double-clicked without requiring launch-time environment variables

The shell does not duplicate routes or screens. The frontend remains in `web/`,
and desktop-specific APIs are exposed through a small preload bridge only when
native behavior is needed.

Bundling a static Next export is not selected for this slice because the
current web app is configured for standalone server output and uses dynamic
runtime integrations. A future packaged-local-server mode can be added after
the Windows path is stable.

## Configuration

Desktop-specific configuration uses `RESONATE_DESKTOP_*` variables documented in
`docs/deployment/environment.md` and `desktop/README.md`.

Runtime precedence is:

1. launch-time environment variables
2. bundled `generated/runtime-config.json`
3. local development defaults

The frontend still owns:

- `NEXT_PUBLIC_API_URL`
- `NEXT_PUBLIC_CHAIN_ID`
- `NEXT_PUBLIC_RPC_URL`
- wallet, passkey, bundler, and x402 browser configuration

The desktop shell must not hardcode staging or production URLs.

## Native Capabilities

Initial shell responsibilities:

- create the native application window
- keep product navigation inside the configured app origin
- open external origins in the system browser
- prompt before saving downloads
- provide a small preload bridge for runtime detection and future native file
  picker adapters

Existing web file inputs and drag/drop continue to use Chromium-native behavior.
Audio playback remains browser-based inside the app window for this slice.

Planned follow-up capabilities:

- signed Windows installer QA
- macOS signing/notarization
- Linux AppImage/deb QA
- deep-link protocol handlers for auth callbacks or app links
- auto-update channel and signing strategy
- notification integration for long-running upload or marketplace events

## Security Posture

The shell uses:

- `contextIsolation: true`
- `nodeIntegration: false`
- `sandbox: true`
- a preload bridge with narrow IPC methods
- external navigation interception
- external OS handoff limited to `http:`, `https:`, and `mailto:` URLs
- save-dialog mediation for downloads

The web app keeps its own CSP and wallet safety posture. The desktop shell
should not inject wallet providers or expose Node.js APIs to renderer code.

## Packaging

The `desktop/` package uses Electron and `electron-builder`. Electron is pinned
to a version outside the npm minimum-release-age window so dependency installs
respect the repo supply-chain policy.

Supported local commands:

- `npm run package:dir` for a smoke packaged directory
- `npm run dist:win` for Windows NSIS/portable artifacts
- `npm run dist:mac` for macOS dmg/zip artifacts
- `npm run dist:linux` for Linux AppImage/deb artifacts

CI runs `npm run package:dir` on Windows, macOS, and Linux for pull requests
that touch the desktop package and uploads the unpacked app directories as
short-lived smoke artifacts.

The `Desktop Release Artifacts` workflow builds installer/distribution files
with `npm run dist:win`, `npm run dist:mac`, and `npm run dist:linux`. It runs
automatically for `v*` and `desktop-v*` tags, can be started manually for one or
all platforms, uploads downloadable workflow artifacts, and attaches artifacts
to a GitHub Release for tag builds. Tag builds require the `DESKTOP_WEB_URL`
repository variable so release packages do not accidentally ship with the local
development fallback.

Windows is the first manual QA target. macOS and Linux use the same
configuration, but release signing and notarization are still follow-up work.
