# Vision Sprint 16 — Deferred Dependency Majors

> **Status:** Active from 2026-08-30. This sprint admits the reviewed Kernel
> dependency-boundary work in #1655.

- **Milestone:** Vision Sprint 16 — deferred dependency majors
- **Revenue line / phase:** vision-neutral infrastructure and security quality.
  This sprint changes no fees, payouts, prices, licensing rules, collectibles,
  or production authority.
- **Window:** no due date. Close when the isolated v4 harness and legacy
  default build are green in clean CI, and the deployment boundary is documented.
- **Capacity:** one bounded contract/tooling slice covering dependency pins,
  compatibility tests, bootstrap, and operator documentation.

## Milestone Goal

Make Kernel v4 verifiable without silently changing Resonate's existing Kernel
v3.1/EntryPoint v0.7 runtime or authorizing migration of deployed accounts.

## Priorities

| Tier | Outcome | Evidence |
| --- | --- | --- |
| P0 | Pin Kernel v4 as the primary verified dependency and retain Kernel v2.4 at an explicit legacy path. | Two gitlinks, remappings, lock evidence, and clean legacy Foundry build. |
| P0 | Add an isolated Solidity 0.8.33/Prague harness using v4 `KernelFactory`, `KernelUUPS`, `KernelImmutableECDSA`, EntryPoint v0.9, and empty `Install[]`. | Focused deterministic-address, signer, nonce, initialization, value-forwarding, and fuzz tests. |
| P1 | Keep CI/bootstrap and operator docs synchronized. | All contract workflows initialize the legacy `I4337` path; v4 soldeer inputs are locked and harness-only. |

## Explicit non-goals

- No production or shared-network deployment.
- No migration, live-account rewrite, or authorization of existing v3.1
  accounts by Kernel v4.
- No changes to backend/web SDK behavior, AA addresses, or
  `UniversalSigValidator`.
- No standalone ECDSA validator plugin and no npm dependency remediation.

## Exit Criteria

- `FOUNDRY_PROFILE=ci forge build --root contracts` passes on the legacy
  compiler/remappings.
- `forge test --root contracts/kernel-v4 --match-path
  test/KernelFactoryCompatibility.t.sol` passes with the pinned v4 inputs.
- Clean CI checkouts initialize `kernel-v3/lib/I4337` and install the v4
  `soldeer.lock` dependencies without floating major resolution.
- Local AA and deployment docs state the compatibility-only boundary clearly.

## Review Handoff

Root review should validate the two dependency pins, inspect compiler/EVM
isolation, and complete the repository's security and change-impact checks
before any future decision about a production Kernel major migration. The
contracts owner should reassess the v4 pin when upstream publishes a stable v4
tag; promoting the harness into an application or deployment path still
requires a separately reviewed migration issue.
