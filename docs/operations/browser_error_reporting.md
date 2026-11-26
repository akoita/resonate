# Browser error reporting

Some failures only happen in the visitor's browser: a script error after a
deploy, a promise nobody handled, a page that renders blank. The API can be
healthy the whole time, so server monitoring never sees them. The web app
reports them itself, with no third-party service.

## How it works

1. `web/src/instrumentation-client.ts` runs before the app becomes
   interactive (a Next.js convention) and installs two listeners from
   `web/src/lib/monitoring/browserErrors.ts`:
   - `error`: uncaught exceptions. React 19 also sends uncaught render
     errors here.
   - `unhandledrejection`: promises that failed with no `catch`.
2. Each error is shrunk to a small JSON report and sent with
   `navigator.sendBeacon` to the same-origin `POST /api/browser-reports/error`.
   Beacons survive page unload and never block the page.
3. The route writes one log line in the shape **Cloud Error Reporting**
   recognises (`@type: ...ReportedErrorEvent`, the stack in `message`,
   `serviceContext.service = "resonate-web-browser"` and the build version).
   Error Reporting then groups identical errors, counts them, and shows first
   and last seen, next to the backend's errors.

## Limits, privacy and cost

- At most 5 reports per page load, and a repeated error is sent once.
  Each web instance logs at most 120 reports a minute.
- No user id and no cookies. Query strings are removed from the page path,
  the script URL and every URL in the stack. Messages are cut to 300
  characters and stacks to 4,000.
- Stacks point at the minified production bundles. Source maps are not
  uploaded, so read a frame by its chunk name and line, or reproduce
  locally.
- The log lines fall inside Cloud Logging's free allotment at this volume.

Log event: `browser.error` (see the
[observability contract](./production_observability_contract.md#web-security-events)).
