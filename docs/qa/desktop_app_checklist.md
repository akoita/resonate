# Desktop App QA Checklist

Issue: [#781](https://github.com/akoita/resonate/issues/781)

Run this checklist for each supported OS before publishing desktop artifacts.

## Common Setup

```bash
npm install -g npm@11.14.1
cd web && npm ci --legacy-peer-deps
cd ../desktop && npm ci
```

## Local Smoke

- `npm run dev` starts or connects to the web app.
- The app window opens at a desktop-sized layout.
- Home, Discover, Player, Library, Marketplace, Upload, Wallet, and AI DJ routes
  render without duplicated desktop-only screens.
- External links open in the system browser.
- Downloads ask for a save location.
- File inputs open the native file picker.
- Drag/drop upload behavior matches the web app where supported.
- Audio continues playing when the window loses focus.
- Wallet/passkey flows behave the same as the current web app for the selected
  environment.

## Packaging Smoke

```bash
cd desktop
npm run lint
npm run package:dir
```

Confirm `desktop/dist/` contains a runnable unpacked app.

## Windows

- `npm run dist:win` produces NSIS and portable artifacts.
- Installer launches, installs for the current user, and can uninstall cleanly.
- Portable artifact launches without installation.
- Windows SmartScreen/signing status is recorded for the release.

## macOS

- `npm run dist:mac` produces dmg/zip artifacts on a macOS runner or machine.
- App launches after quarantine/signing checks expected for the build type.
- Notarization status is recorded for public release candidates.

## Linux

- `npm run dist:linux` produces AppImage and deb artifacts.
- AppImage launches on the target distro.
- deb installs and removes cleanly.

## Release Notes

Record:

- OS and version
- artifact filename and SHA256
- web origin used by `RESONATE_DESKTOP_WEB_URL`
- known limitations
- signing/notarization status
