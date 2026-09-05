# CodeQL baseline triage — 2026-08-26

## Executive summary

This review dispositioned all 19 JavaScript/TypeScript CodeQL alerts from the
initial advisory baseline. Seven alerts map to four accepted private findings:
two High and two Medium. Eleven alerts were dismissed as false positives, and
one informational log-integrity alert was dismissed as accepted risk.

Seven alerts remain open for remediation. The measured false-positive rate is
57.9% (11 of 19), so CodeQL remains advisory and must not become a required
merge check from this baseline. The four accepted findings are recorded in
private draft advisories; this public repository artifact deliberately omits
working payloads, private deployment assumptions, credentials, and exploitable
source-to-sink detail.

## Scope and exclusions

The review covered the 19 alerts reported by CodeQL default setup for
JavaScript/TypeScript. The initial run was
[`32799678109`](https://github.com/akoita/resonate/actions/runs/32799678109)
at `ccce700688187c459ffad3f6b58d8395f0441398`; current alert instances were
rechecked on `main` at `c325ff87bbbfe3d7d395921de0bbf9c7c33aefa9`.

The review traced the flagged application paths, applicable guards and input
limits, focused tests, and relevant repository security context. It did not
scan for new findings, triage Dependabot issue #1626, inspect the private
`resonate-iac` repository or live cloud configuration, contact production or
third-party services, publish a release, or change credentials.

No paid external-tool spend was used. Potentially sensitive evidence is
retained only in private draft advisories, referenced below by non-sensitive
stable labels rather than private advisory identifiers.

## Context manifest

| Source | Revision | Boundary and claim used | Sensitivity |
| --- | --- | --- | --- |
| `SECURITY.md` | `c325ff87` | Disclosure policy and safe-testing constraints | Public |
| `backend/AGENTS.md`, `web/AGENTS.md` | `c325ff87` | Local validation and external-service test rules | Public |
| `docs/architecture/security_risk_register.md` and application/storage architecture | `c325ff87` | Declared service, data, and deployment boundaries | Public |
| `audit/supply-chain/repository-security-profile.json` | `c325ff87` | T4 ownership, monitoring, and private cloud boundaries | Public |
| GitHub CodeQL alert metadata | Retrieved 2026-08-26 | Rule, data-flow lead, location, and current state | Maintainer access |
| Draft advisories below | Created 2026-08-26 | Full finding records and remediation evidence | Private |

No nested `SECURITY.md` applies to the reviewed paths. Where deployment state
could not be proven from this repository, confidence and impact were reduced
rather than inferred from production.

## Findings and dispositions

### Accepted private findings

| Stable finding | Alerts | Validated severity / confidence | Lifecycle state |
| --- | --- | --- | --- |
| `CWE-1333-backend-signal-string-sanitizers` | #1, #6 | High / Medium | Accepted; dedicated private remediation required |
| `CWE-918-backend-encryption-decrypt-uri` | #9–#11 | High / High code-path confidence, Medium deployment-impact confidence | Accepted; dedicated private remediation required |
| `CWE-79-backend-encryption-exception-html` | #13 | Medium / High | Accepted; private remediation tracked |
| `CWE-639-backend-realtime-session-ownership` | #16 | Medium / High | Accepted; private remediation tracked |

Each private record contains the required locations, preconditions, attack
path, impact, evidence, recommendation, affected revision, and lifecycle
state. High findings require dedicated fix branches and regression tests.
Medium findings remain privately tracked until a safe remediation is merged.

### Rejected or accepted-risk leads

| Alerts | Flagged location | Disposition | Evidence-backed rationale |
| --- | --- | --- | --- |
| #2–#5 | `backend/src/modules/auth/auth.controller.ts:69,116,164,180` | False positive | One nonce-regex root cause. The 100 KB parser ceiling, route throttle, and bounded exact-pattern benchmark showed sub-millisecond linear behavior with no demonstrated availability impact. |
| #7 | `backend/scripts/mint-agent-identity.ts:324` | False positive | The environment-derived value reaching output is the intended public smart-account address. The private key does not reach the sink; only its public signer address is emitted. |
| #8 | `backend/src/modules/contracts/human-verification.service.ts:38` | False positive | Request data affects a path segment, while scheme and authority come from fixed defaults or deployment configuration. No attacker-controlled authority was demonstrated. |
| #12 | `web/src/components/punchline/PunchlineCollectibleCard.tsx:86` | False positive | React renders an image attribute and escaped text nodes. No `innerHTML` or `dangerouslySetInnerHTML` sink exists in this path. |
| #14 | `scripts/release-policy.mjs:138` | False positive | The transformed Markdown template text is used only for a boolean content-presence check and is never rendered as HTML. |
| #15 | `backend/src/modules/auth/auth.controller.ts:109` | Informational; accepted risk (`won't fix`) | Input can affect formatting of one diagnostic error argument, but no authentication, authorization, response, or security decision. |
| #17 | `web/src/lib/productAnalytics.ts:172` | False positive | The fallback is telemetry correlation metadata, not a secret, token, authorization capability, or uniqueness boundary. |
| #18–#19 | `web/src/lib/playerContext.tsx:504,962` via `web/src/lib/playbackAnalytics.ts:46` | False positive | The shared fallback IDs correlate playback analytics only; prediction grants no additional action or authority. |

GitHub dismissal comments retain the revision and concise rationale for every
closed alert. Alert #15 uses `won't fix`, not `false positive`, because the
formatting behavior exists but has no demonstrated security impact.

## Tool coverage and validation

| Tool | Version | Target | Result | Finding contribution |
| --- | --- | --- | --- | --- |
| GitHub CodeQL | 2.26.3 | JavaScript/TypeScript default setup | Initial run succeeded; 19 alerts reviewed | 19 leads, not accepted findings by itself |
| GitHub code-scanning API | API as of 2026-08-26 | Current states at `c325ff87` | 12 dismissed, 7 open | Persisted alert dispositions |
| Manual source and history trace | Git `c325ff87` | Every flagged path and applicable controls | Completed | Four accepted root causes |
| Node.js benchmark | 24.5.0 | Exact flagged regex patterns, bounded synthetic inputs | Exit 0 | Confirmed one superlinear sanitizer family; rejected the nonce-regex family |
| Jest | 29.7.0 | Six focused backend suites | 56/56 passed | Existing behavior and provider-path coverage |
| Vitest | 4.1.11 | Three focused web suites | 40/40 passed | React rendering and analytics-ID coverage |
| Node test runner | 24.5.0 | Release-policy suite | 15/15 passed | Confirmed non-HTML policy behavior |
| T4 profile validator | agent-toolkit 0.5.9 / Python 3.13.6 | Repository security profile schema 1.0 | Exit 0 | Control-document integrity |

The deterministic validation did not contact external providers. Existing
tests do not substitute for the dedicated negative and authorization
regressions required by the private findings.

## Assumptions

- Nest's standard Express adapter retains its default 100 KB JSON body limit;
  the application does not override it in `backend/src/main.ts`.
- Live storage-provider selection, cloud ADC scope, egress controls, and
  provider URL overrides are private deployment facts and were not inferred.
- The backend API and web application may use different origins. The reflected
  HTML finding is therefore rated Medium pending deployment-specific origin
  confirmation.
- Analytics session and event IDs are used only for telemetry correlation, as
  shown by their consumers at the reviewed revision.

## Open questions and next actions

1. Confirm the deployed storage provider, ADC scope, redirect behavior, and
   egress policy privately before finalizing the SSRF patch and residual risk.
2. Remediate the two High findings on dedicated private branches with negative
   tests, then re-run CodeQL and close their alerts only when fixed evidence is
   present.
3. Sequence the two Medium findings with the same private-review discipline.
4. Recalculate the false-positive rate after remediation. Any proposal to make
   CodeQL required remains a separate decision and must identify a narrow,
   low-noise blocking set.

## Business-model conformance

This work is vision-neutral infrastructure and security quality
(`vision:keep`). It changes no fee, payout, ingestion, AI billing, collectible,
licensing, custody, or product behavior.
