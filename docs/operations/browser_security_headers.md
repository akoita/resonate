# Browser security headers

The web app and the API send security headers on every response. They tell
the browser to refuse whole classes of attacks, whatever bug a page may have.

| Header | Web app | API | What it does |
| --- | --- | --- | --- |
| `Strict-Transport-Security` | 2 years, subdomains | same | HTTPS only for the host; no downgrade to HTTP. No `preload` (hard to undo). |
| `X-Content-Type-Options: nosniff` | yes | yes | The browser trusts `Content-Type` and never guesses a file into a script. |
| `X-Frame-Options: DENY` + CSP `frame-ancestors 'none'` | yes | yes | No other site can frame our pages (clickjacking). |
| `Content-Security-Policy` (enforced) | `frame-ancestors`, `base-uri`, `object-src` | `default-src 'none'` | Web: no framing, no `<base>` hijack, no plugins. API: a response opened as a page can't load or run anything. |
| `Content-Security-Policy-Report-Only` | full policy | – | What scripts, styles, media and connections may load. Reported, not enforced (below). |
| `Referrer-Policy` | `strict-origin-when-cross-origin` | `no-referrer` | Other sites see our origin at most, never a full URL. |
| `Permissions-Policy` | camera, microphone, location, USB, … off | – | Features the app never uses are off for us and anything we embed. |
| `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | – | Pages we open can't reach back into ours; wallet and passkey pop-ups still work. |
| `Cross-Origin-Resource-Policy` | – | `cross-origin` | Stated so the web app (another origin) can keep loading artwork and audio. |

Code: `web/src/lib/build/securityHeaders.cjs` (wired in `web/next.config.js`)
and `backend/src/modules/shared/security_headers.middleware.ts` (wired in
`backend/src/main.ts`). Both also drop `X-Powered-By`.

## Why the script policy is report-only

A Content-Security-Policy is the strongest defence against an injected
script, but a wrong policy breaks the app: playback, sign-in and wallets talk
to origins that differ per environment. So the full policy ships in
report-only mode first. The browser blocks nothing and posts a report for
each resource the policy would have blocked to `/api/security/csp-report`,
which logs it as `security.csp_violation` (see the
[observability contract](./production_observability_contract.md#web-security-events)).

Next steps, once a deployed environment has a few weeks of reports:

1. Narrow `connect-src` and `img-src` from `https:` to the origins actually
   reported.
2. Replace `'unsafe-inline'` for scripts with a per-request nonce and
   `'strict-dynamic'` (Next.js supports this through `proxy`; it makes pages
   dynamically rendered, so measure the load cost first).
3. Move the policy to the enforced `Content-Security-Policy` header.

Checking a deployed environment: `curl -sI <web origin>/` and look for the
headers above, or run the browser devtools "Issues" panel, which lists
report-only violations as they happen.
