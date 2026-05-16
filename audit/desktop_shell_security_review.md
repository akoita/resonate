# Desktop Shell Security Review

Issue: [#781](https://github.com/akoita/resonate/issues/781)

## Scope

- `desktop/src/main.cjs`
- `desktop/src/preload.cjs`
- `desktop/src/runtime-config.cjs`
- `desktop/scripts/start-dev.mjs`
- `desktop/scripts/validate-config.mjs`
- `desktop/electron-builder.yml`
- `desktop/package.json`
- `desktop/package-lock.json`
- desktop docs and QA checklist

## Findings

- Critical: none in the changed code.
- High: none in the changed code.
- Medium: none in the changed code.
- Low: none in the changed code.

## Security Notes

- The desktop shell uses `contextIsolation: true`, `nodeIntegration: false`,
  and `sandbox: true`.
- Renderer code receives only a narrow `window.resonateDesktop` preload bridge.
- External navigation is intercepted. Same-origin app navigation stays in the
  shell; external `http:`, `https:`, and `mailto:` URLs open in the system
  browser; other protocols are ignored by the shell.
- Downloads are mediated through a native save dialog before writing to disk.
- The loaded web origin is configured with `RESONATE_DESKTOP_WEB_URL` and
  defaults only to local development. No staging or production URL is hardcoded.
- Electron is pinned to an older release outside the npm minimum-release-age
  window. `npm audit --audit-level=moderate` reports zero vulnerabilities for
  the desktop package after the pin.

## Commands Run

```bash
cd desktop && npm install --package-lock-only --ignore-scripts
cd desktop && npm ci
cd desktop && npm run lint
cd desktop && npm audit --audit-level=moderate
cd desktop && npm run package:dir
npm run security:lock-sources
git diff --check
rg -n 'https://staging|pydes|resonate\\.pydes|BEGIN (RSA|EC|OPENSSH|PRIVATE) KEY|sk-[A-Za-z0-9]|gho_[A-Za-z0-9_]'
```
