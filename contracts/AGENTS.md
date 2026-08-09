# Resonate Contracts — Testing & Verification Standards

> Loaded when working under `contracts/`. Project-wide rules live in the root
> [AGENTS.md](../AGENTS.md). As at the repo root, `CLAUDE.md` here is a symlink
> to this file.


Smart contracts are asset-custody and protocol-truth code. Treat every contract
change as security-sensitive, even when the change looks small.

## Deployment Key Safety

Forge scripts that broadcast transactions must never silently use the default
Anvil private key on a remote/non-local RPC. Use the shared deployment-key
helper in `contracts/script/DeploymentKey.s.sol` for every deploy, upgrade, or
admin-update script.

- Remote environments (`dev`, `staging`, `test`, `prod`, or any shared RPC)
  must provide an explicit `PRIVATE_KEY` / `CONTRACT_DEPLOYER_PRIVATE_KEY`.
- The default Anvil key is acceptable only for local chains or when a local/fork
  command explicitly sets `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY=true`.
- Do not set `ALLOW_DEFAULT_ANVIL_PRIVATE_KEY` in GitHub deployment
  environments.
- If a script needs a different signer model, document it in
  `docs/smart-contracts/deployment.md` before wiring it into CI.

## Deployment Output Handoffs

Every deploy script that creates or changes an address-bearing contract must
produce machine-readable handoff files under `contracts/deployments/` before it
is considered CI/deploy ready:

- a JSON deployment record with network, chain ID, deployer, owner/admin when
  relevant, contract addresses, transaction hash, broadcast path, artifact path,
  ABI path, and ABI hash;
- a `.remote.env` handoff containing only non-secret app/runtime variables that
  `resonate-iac`, GitHub environments, GCP Secret Manager, or Cloud Run config
  need to consume;
- an ABI handoff, or a documented generated ABI module, for any app-side code
  that submits calls, decodes events, or validates contract data.

Never make app deployment depend on copied console output. If an existing
contract deploy path only uploads raw Foundry broadcasts, improve it to follow
this pattern before adding more downstream automation.

## Required Test Ladder

Use the strongest practical layer for the risk of the change. Do not rely on
happy-path unit tests alone for contracts that hold funds, gate authority, route
payments, enforce royalties, or control upgrades.

| Layer | Required When | Runner / Tool |
| --- | --- | --- |
| Unit tests | Every Solidity behavior change | `cd contracts && forge test --match-path test/unit/...` |
| Fuzz/property tests | Any function with numeric bounds, authorization branching, accounting, transfers, mint/list/buy flows, or non-trivial input space | Foundry fuzz tests in `contracts/test/fuzz/` |
| Invariant tests | Any stateful protocol, escrow, marketplace, token supply, role/permission, or multi-step lifecycle | Foundry invariant tests in `contracts/test/invariant/` |
| Symbolic/formal tests | Asset custody, release/refund logic, upgrade authorization, royalty/payment conservation, or subtle state-machine rules | Halmos/Kontrol/Certora Prover, or a documented deferral |
| Mutation testing | High-value contracts, new formal specs, or contract suites where test strength is uncertain | Certora Gambit, or a documented deferral |
| Static/security scan | Before PR completion for material contract changes | `security-smart-contracts` via `/finish-issue` §5 (see `.agents/skills/auditing-resonate-security/`) |

For a new contract that holds or routes funds, the default expectation is:

- unit tests for all lifecycle transitions and access-control failures;
- fuzz/property tests for amount, deadline, basis-point, and boundary behavior;
- invariant tests for conservation of funds and impossible state transitions;
- symbolic/formal tests for at least the core safety property, or an explicit
  note explaining why formal coverage is deferred.
- mutation testing for high-value escrow/marketplace/payment contracts before
  production launch, or an explicit note explaining why it is deferred.

## Preferred Maintained Tools

Prefer tools with active maintenance and real adoption:

- **Foundry** for unit, fuzz, invariant, fork, and gas testing:
  <https://book.getfoundry.sh/>
- **Halmos** for symbolic testing from Foundry-style Solidity tests:
  <https://github.com/a16z/halmos>
- **Kontrol** for Foundry-compatible formal verification on KEVM:
  <https://docs.runtimeverification.com/kontrol>
- **Certora Prover** for high-assurance CVL specifications on critical
  economic/security properties:
  <https://docs.certora.com/en/latest/docs/prover/index.html>
- **Certora Gambit** for Solidity mutation testing, especially to evaluate
  whether tests or CVL specs catch intentionally injected logic faults:
  <https://docs.certora.com/en/latest/docs/gambit/index.html>
- **Echidna** and **Medusa** from Crytic/Trail of Bits for long-running
  property fuzzing campaigns when Foundry fuzzing is not enough:
  <https://github.com/crytic/echidna> and <https://github.com/crytic/medusa>

Avoid adopting unmaintained or research-only tools as required project gates.
They can be useful for experiments, but not as the main standard.

## Shared Contract Surfaces

Use the narrowest canonical Solidity surface that matches the ownership of a
declaration:

- definitions with identical semantics across multiple production contracts
  belong in a focused capability interface under `contracts/src/common/`;
- contract-specific events, errors, enums, structs, and core function
  signatures belong in that contract's interface under
  `contracts/src/interfaces/`;
- implementation-only declarations remain beside their implementation.

Domain interfaces inherit the common capability interfaces they use. Production
contracts and tests then inherit the domain interface, so event topics and error
selectors have one declaration without advertising unrelated common errors.
Do not create catch-all `Errors.sol`, `Events.sol`, or `DataTypes.sol` modules,
and do not mix shared types with behavioral libraries.

Examples:

- `IUpgradeAuthority` owns the shared upgrade-authority event and error.
- `IFailedPaymentRecovery` owns the shared pull-payment recovery events and
  errors.
- `IShowCampaignEscrow` owns `CampaignStatus`, `Campaign`, and its
  campaign-specific errors and events while inheriting the common capabilities
  it uses.
- `ShowCampaignEscrow` implements/imports that interface.
- Tests import the same interface for `expectRevert` selectors and
  `expectEmit` declarations.

This prevents tests from silently duplicating event/error declarations that later
drift from production.

## ERC-7201 Storage Ownership

Every newly deployed upgradeable core contract must use ERC-7201 namespaced
storage from its first implementation. The annotated namespace struct, namespace
constant, and storage accessor stay inside the owning contract. An annotated
struct declared outside a contract is not recognized as that contract's ERC-7201
namespace.

Storage-only nested structs should also remain contract-local unless a reviewed,
versioned protocol type genuinely has to be shared. Never move an existing
deployed mapping or dynamic collection from a legacy linear layout into a
namespace as a mechanical refactor: those entries are not enumerable and a
reinitializer cannot safely copy them. Existing proxies require an explicit
per-contract decision to retain linear storage, use a compatibility-preserving
hybrid, or deploy a replacement with a chain-specific state-transition plan.

## Test Directory Conventions

Keep Solidity tests organized by verification layer:

- `contracts/test/unit/` for deterministic examples and access-control cases;
- `contracts/test/fuzz/` for Foundry property tests over dynamic inputs;
- `contracts/test/invariant/` for stateful handler-based invariant suites;
- `contracts/test/formal/` for Halmos/Kontrol-compatible symbolic tests;
- `contracts/certora/conf/` and `contracts/certora/specs/` for Certora Prover
  configuration and CVL specs.

Name files by contract or protocol surface, for example
`ShowCampaignEscrow.fuzz.t.sol`, `ShowCampaignEscrow.invariant.t.sol`, and
`ShowCampaignEscrow.formal.t.sol`. Keep handlers and mocks close to the layer
that uses them unless they are reused across several suites.

## Custom Error Context

Prefer Solidity custom errors over revert strings. Add parameters when they help
identify the failing object, actor, bound, expected value, or actual value.

Good examples:

```solidity
error InvalidCampaignStatus(uint256 campaignId, CampaignStatus current, CampaignStatus expected);
error DepositReleaseTooHigh(uint256 requestedBps, uint256 maxBps);
error UnauthorizedConfirmer(address caller);
error InsufficientPledge(uint256 campaignId, address backer, uint256 amount);
```

Do not add parameters mechanically. Keep parameterless errors for obvious local
preconditions where context adds noise, such as `ZeroAmount()` or
`ZeroAddress()`. Avoid large dynamic data in errors.

## Required Documentation

When a contract introduces or changes durable protocol behavior:

- update `contracts/README.md` and relevant `docs/smart-contracts/*` pages;
- update feature docs if the contract changes a product-facing capability;
- document any omitted fuzz, invariant, or formal layer in the PR summary or
  feature plan.

---
