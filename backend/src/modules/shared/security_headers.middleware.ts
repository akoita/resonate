import { type NextFunction, type Request, type Response } from "express";

/**
 * Browser security headers for every API response.
 *
 * The API answers JSON, audio and images; it never serves a page meant to
 * run scripts. So the policy can be strict without breaking anything:
 *
 * - `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`:
 *   if a response is ever opened as a document, it can't load or run
 *   anything, and no site can frame it. An image or audio file opened
 *   directly still displays, because the browser renders the file itself.
 * - `X-Content-Type-Options: nosniff`: the browser uses our Content-Type and
 *   never guesses, so an uploaded file can't be reinterpreted as a script.
 * - `Strict-Transport-Security`: HTTPS only for this host, for two years.
 * - `Referrer-Policy: no-referrer`: links out of an API response carry no URL.
 * - `Cross-Origin-Resource-Policy: cross-origin`: stated explicitly because
 *   the web app (another origin) loads our artwork and audio. The common
 *   "same-origin" default from generic middleware would break playback.
 * - `X-Frame-Options: DENY`: the older spelling of `frame-ancestors`.
 *
 * Handlers may still override a header for their own response.
 */
export const API_SECURITY_HEADERS: Readonly<Record<string, string>> = Object.freeze({
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'",
  "X-Content-Type-Options": "nosniff",
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "cross-origin",
  "X-Frame-Options": "DENY",
});

export function securityHeadersMiddleware() {
  return (_req: Request, res: Response, next: NextFunction) => {
    for (const [name, value] of Object.entries(API_SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }
    next();
  };
}
