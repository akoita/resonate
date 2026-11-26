// Browser security headers for every page the web app serves.
//
// Two groups, on purpose:
//
// 1. ENFORCED headers. Each one is safe for how this app works today (no
//    page is meant to be framed, nothing uses the camera, microphone or
//    location), so it can be on from day one:
//    - Strict-Transport-Security: after one HTTPS visit, the browser refuses
//      plain HTTP for this host for two years, so nobody on the network can
//      downgrade the connection. `preload` is left out because leaving the
//      browsers' preload list again takes months.
//    - X-Content-Type-Options: the browser trusts our Content-Type instead
//      of guessing, so an uploaded file can't be "sniffed" into a script.
//    - X-Frame-Options plus CSP `frame-ancestors 'none'`: no other site can
//      put our pages in an invisible frame and trick a click (clickjacking).
//      X-Frame-Options is the old spelling; frame-ancestors is the modern one.
//    - CSP `base-uri 'self'` and `object-src 'none'`: an injected <base> tag
//      can't redirect relative script URLs, and no plugin content runs.
//    - Referrer-Policy: other sites see only our origin, never a full URL
//      that could carry an id.
//    - Permissions-Policy: powerful browser features we never use are
//      switched off for us and for anything we embed.
//    - Cross-Origin-Opener-Policy `same-origin-allow-popups`: a page we open
//      can't reach back into ours through `window.opener`, while wallet and
//      passkey pop-ups still work.
//
// 2. A REPORT-ONLY Content-Security-Policy. CSP is the strongest defence
//    against injected scripts, but the app talks to many origins (API,
//    chain RPC, bundler, wallet relay, audio storage), so a wrong enforced
//    policy would break playback or sign-in. Report-only means the browser
//    blocks nothing and only reports what it *would* have blocked to
//    `/api/security/csp-report`, which logs it to Cloud Logging. Once a few
//    weeks of reports are clean, the same policy moves to the enforced
//    header.
//
// Kept in CommonJS because next.config.js loads it.

const REPORT_PATH = "/api/security/csp-report";

function originOf(rawUrl) {
  if (!rawUrl) return null;
  try {
    return new URL(rawUrl).origin;
  } catch {
    return null;
  }
}

function websocketOriginOf(origin) {
  if (!origin) return null;
  if (origin.startsWith("https://")) return `wss://${origin.slice("https://".length)}`;
  if (origin.startsWith("http://")) return `ws://${origin.slice("http://".length)}`;
  return null;
}

function directive(name, sources) {
  const unique = [...new Set(sources.filter(Boolean))];
  return unique.length ? `${name} ${unique.join(" ")}` : name;
}

/**
 * The report-only policy. `'unsafe-inline'` for scripts is needed until the
 * app sends a per-request nonce (Next.js inlines its bootstrap scripts); the
 * reports show whether anything else is missing before that step.
 */
function reportOnlyContentSecurityPolicy(env) {
  const apiOrigin = originOf(env.NEXT_PUBLIC_API_URL || "http://localhost:3000");
  const apiSocketOrigin = websocketOriginOf(apiOrigin);
  return [
    directive("default-src", ["'self'"]),
    // React needs eval only in development, for its debug stacks.
    directive("script-src", [
      "'self'",
      "'unsafe-inline'",
      "'wasm-unsafe-eval'",
      env.NODE_ENV === "development" ? "'unsafe-eval'" : null,
    ]),
    directive("style-src", ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"]),
    directive("font-src", ["'self'", "data:", "https://fonts.gstatic.com"]),
    directive("img-src", ["'self'", "data:", "blob:", "https:"]),
    directive("media-src", ["'self'", "blob:", "data:", apiOrigin, "https://storage.googleapis.com"]),
    // Chain RPCs, bundlers and wallet relays are configured per environment,
    // so connections allow any HTTPS/WSS origin; the reports will show which
    // ones are really used before this is narrowed.
    directive("connect-src", ["'self'", apiOrigin, apiSocketOrigin, "https:", "wss:"]),
    directive("frame-src", ["'self'", "https://verify.walletconnect.com", "https://verify.walletconnect.org"]),
    directive("worker-src", ["'self'", "blob:"]),
    directive("manifest-src", ["'self'"]),
    directive("form-action", ["'self'"]),
    directive("base-uri", ["'self'"]),
    directive("object-src", ["'none'"]),
    `report-uri ${REPORT_PATH}`,
    "report-to csp",
  ].join("; ");
}

/** Headers applied to every route, in the shape next.config.js `headers()` expects. */
function securityHeaders(env = process.env) {
  return [
    { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "X-Frame-Options", value: "DENY" },
    { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    {
      key: "Permissions-Policy",
      value: "camera=(), microphone=(), geolocation=(), usb=(), serial=(), hid=(), bluetooth=(), browsing-topics=()",
    },
    { key: "Cross-Origin-Opener-Policy", value: "same-origin-allow-popups" },
    { key: "Reporting-Endpoints", value: `csp="${REPORT_PATH}"` },
    { key: "Content-Security-Policy-Report-Only", value: reportOnlyContentSecurityPolicy(env) },
  ];
}

module.exports = { securityHeaders, reportOnlyContentSecurityPolicy, REPORT_PATH };
