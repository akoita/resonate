# Dependabot Baseline Triage — 2026-08-30

## Executive Summary

Issue [#1626](https://github.com/akoita/resonate/issues/1626) started from
GitHub's 2026-08-25 report of 270 npm advisory alerts. That remote count is an
alert-instance count and is not directly comparable with npm's local
package-level aggregation.

Against `main` commit `01126579`, local lockfile analysis reported 116
package-level leads: 2 Critical, 33 High, 44 Moderate, and 37 Low. The reviewed
remediation removes unused Lit Protocol dependency trees, refreshes compatible
transitive versions without `--force`, and aligns the Testcontainers packages
on 12.1.0. The resulting locks report no Critical, High, or Low leads and 32
Moderate leads.

Scanner metadata is treated as a lead, not proof of exploitability. No
remaining dependency lead was promoted to a validated security finding because
an attacker-controlled path to impact was not demonstrated end to end.

## Scope And Exclusions

- **Branch:** `codex/1626-dependabot-baseline`
- **Base:** `0112657989806f986f817ac32960b20c889bf296`
- **In scope:** root, backend, web, and desktop npm manifests and locks;
  repository npm source and lifecycle controls; source import/use evidence.
- **Excluded:** vendored Solidity libraries, Python worker graphs, containers,
  GitHub Actions, private infrastructure, and live deployment evidence. Those
  surfaces remain governed by the wider T4 profile and #1551.
- **Remote limitation:** the current GitHub token cannot read the Dependabot
  alert API, so exact post-merge GitHub closure counts must be confirmed after
  the branch reaches `main`.

## Baseline And Result

| Project | Before | After | Disposition |
| --- | ---: | ---: | --- |
| Root | 0 | 0 | No leads. |
| Backend | 1 Critical, 15 High, 35 Moderate, 19 Low | 26 Moderate | Unused dependencies removed, compatible fixes applied, Testcontainers aligned. |
| Web | 1 Critical, 18 High, 9 Moderate, 18 Low | 6 Moderate | Unused dependencies removed and compatible fixes applied. |
| Desktop | 0 | 0 | No leads. |
| **Total** | **2 Critical, 33 High, 44 Moderate, 37 Low** | **32 Moderate** | **No Critical, High, or Low lead remains.** |

Counts come from `npm audit --package-lock-only --ignore-scripts --json` using
npm 11.14.1. They aggregate vulnerable packages rather than GitHub alert
instances.

## Dependency-Family Dispositions

| Family | Reachability and evidence | Fixability | Disposition |
| --- | --- | --- | --- |
| Lit Protocol and its legacy IPFS, ethers, WebSocket, and protobuf tree | Seven direct declarations existed, but no `@lit-protocol` import exists in backend or web source. The only implementation reference describes a future provider (`backend/src/modules/encryption/encryption_provider.ts:6`). | Removal is compatible and eliminates the orphaned graph. | Removed from both applications. |
| Remaining Critical/High protobuf, glob, YAML, WebSocket, and utility paths | Package paths were present in the locks; no direct application API change was required. | Current compatible releases were available. | Updated through non-force, package-lock-only remediation. |
| Testcontainers 11 runtime and Redis adapter | Development/test-only imports live in `backend/src/tests/globalSetup.js:15-17`; PostgreSQL was already on 12.1.0. | A coherent 12.1.0 family is available. | Updated `testcontainers` and `@testcontainers/redis` to 12.1.0. |
| Google ADK, Pub/Sub, Storage, request, and OpenTelemetry graph | Runtime reachable through the ADK runner (`backend/src/modules/agents/runtime/adk_adapter.ts:8-12`, `:52-76`) and Pub/Sub publishers (`backend/src/modules/analytics/analytics_event_publisher.ts:55-70`, `backend/src/modules/ingestion/stem-pubsub.publisher.ts:64-84`). No advisory-specific attacker path to impact was proven. | npm proposes major direct changes, including ADK and Pub/Sub contract changes. A forced downgrade is not acceptable. | Retain as Moderate leads. Owner: Resonate security maintainer. Review by **2026-09-30** or earlier when compatible upstream releases arrive. Keep the ADK API-key gate and 30-second runtime timeout; retain typed Pub/Sub payload construction and focused runtime tests. |
| ZeroDev permissions, Merkle tree, web3-utils, and bn.js graph | Runtime reachable in the session-key permission flow (`web/src/hooks/useSessionKey.ts:80-85`, `:156-201`; `backend/src/modules/identity/kernel_account.service.ts:140-169`). No advisory-specific attacker path through the constructed policy values was proven. | The current direct package reports no upstream fix for this transitive family. | Retain as Moderate leads; do not block unrelated changes on an unfixable transitive. Owner: Resonate security maintainer. Review by **2026-09-30** or on the next ZeroDev release. Preserve BigInt policy limits, typed contract targets, authenticated activation, and the session-key regression suite. |

The two retained runtime groups are `theoretical — no proof` leads, not
validated findings. An upstream fixed release, a demonstrated reachable attack
path, or a change in CISA KEV/EPSS priority triggers immediate re-triage before
the scheduled date.

## Supply-Chain Controls Preserved

- Generic npm installs keep lifecycle scripts disabled and the seven-day
  release cooldown enabled.
- All lockfile sources resolve to the public npm registry or approved local
  references.
- The lifecycle policy exactly inventories every remaining install-script
  tuple. `protobufjs@7.6.5` remains denied because its postinstall output is not
  required; approved native rebuilds retain their existing rationale.
- No `--force`, cooldown bypass, registry override, dependency override, or
  automatic dismissal was used.
- GitHub alerts should close from default-branch dependency-graph processing;
  no alert is dismissed manually without retained evidence.

## Validation

| Check | Result |
| --- | --- |
| Hardened backend install | Passed; approved lifecycle packages rebuilt. |
| Hardened web install | Passed with the existing legacy-peer boundary. |
| npm registry signatures | Not run: the enforced seven-day release cooldown rejected unrelated newly published `@nestjs/common@11.2.3` and `baseline-browser-mapping@2.11.19` before signature verification. The cooldown was not bypassed. |
| Lock-source validation | Passed. |
| Lifecycle-policy validation and regression tests | Passed, 9/9. |
| Backend lint and build | Passed. |
| Backend unit suite | Passed, 152 suites / 1,251 tests. |
| Web lint | Passed with 0 errors and 12 pre-existing warnings. |
| Web unit suite | Passed, 103 files / 978 tests. |
| Web production build | Passed with the existing ox/viem dynamic dependency warning. |

## Tool Coverage

| Tool | Coverage | Result / gap |
| --- | --- | --- |
| npm 11.14.1 audit | Four first-party npm locks | Completed; 32 Moderate package-level leads remain. |
| Repository lock/lifecycle checks | All first-party npm locks | Passed. |
| `osv-scanner` | Not available locally | Install with `go install github.com/google/osv-scanner/v2/cmd/osv-scanner@latest`; CI remains the broad OSV evidence source. |
| `syft` | Not available locally | Install with `brew install syft` or the upstream installer; release SBOM evidence remains #1551 scope. |
| `grype` | Not available locally | Install with `brew install grype` or the upstream installer; local container/package cross-check was not performed. |
| `zizmor` / `actionlint` | Not available locally | Install with `uv tool install zizmor` and `go install github.com/rhysd/actionlint/cmd/actionlint@latest`. Workflow files are unchanged, so CI/CD scanning was outside this dependency-only pass. |

## Assumptions And Open Questions

- npm registry advisory data and the checked-in locks reflect the graph GitHub
  will process after merge; the remote alert API limitation prevents a direct
  one-to-one reconciliation before merge.
- The removed Lit dependencies are intentionally future-only. Reintroducing a
  Lit provider requires a new implementation issue, intake review, source
  usage, tests, and a fresh advisory assessment.
- The Google and ZeroDev groups need upstream compatibility work rather than a
  forced bulk upgrade. Their 2026-09-30 reviews must record either a safe
  upgrade, a renewed time-bounded disposition, or a newly validated finding.
