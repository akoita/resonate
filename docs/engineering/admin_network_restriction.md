# Restricting the admin surface by network (optional mechanism)

Resonate does not require or implement a network restriction. This page
documents the mechanism an operator may put in front of an instance as defence
in depth; it never replaces the application checks (admin JWT role, step-up
proof, audit log).

## What can be restricted

- **Web pages:** everything under `/admin/*` on the frontend (and
  `/disputes/admin`).
- **Backend API:** the admin routes live under `/admin/*` (accounts, users,
  agent sessions, audit events, step-up). Some role-gated routes sit elsewhere
  (for example `POST /notices/broadcast`, `/notices/targeted`, `/notices/sent`),
  so a prefix rule on `/admin/*` alone does not cover every admin-only action;
  list the exact paths from the controllers carrying `@Roles("admin")` /
  `@Roles("admin", "operator")`.

## How

Apply an allowlist of source networks at whatever edge fronts the app (reverse
proxy, load balancer or WAF) for those path prefixes, returning `403` for other
sources. The application needs no change: it already refuses a non-admin with
`403` and a missing step-up proof with `403 step_up_*`.

## Constraints that bind the code

- The admin web pages call the API from the admin's browser, so a restricted
  backend prefix requires the admin's browser to be inside the allowed network
  too.
- Health checks, webhooks and scheduled callers must not use these prefixes: all
  admin routes require an admin JWT, so no scheduled caller can reach them.
- `X-Forwarded-For` is not used by the application for any decision.

Deployment values (networks, rules, platform wiring) belong in `resonate-iac`.
