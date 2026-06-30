---
title: "RFC: Contract Upgradeability & Emergency Recovery Strategy"
status: proposed
author: "@akoita"
created: "2026-06-30"
related:
  - "../smart-contracts/core_contracts.md"
  - "./show-campaign-trust-escrow.md"
  - "./content-protection-architecture.md"
tracking: "Umbrella issue #1300"
---

# RFC: Contract Upgradeability & Emergency Recovery Strategy

## Abstract

Should Resonate's main contracts be upgradeable? Today only `ContentProtection`
is (UUPS); the fund-custody contracts — `ShowCampaignEscrow`, `RevenueEscrow`,
`StemMarketplaceV2` — and `StemNFT` / `TransferValidator` are immutable. There is
no timelock, no multisig/governance owner, and no recorded stance.

The honest premise behind the question is correct: **smart-contract security
cannot be *guaranteed*.** The source/bytecode is public, the attack surface is
permanently exposed to an unbounded set of motivated adversaries, and even
reference-grade, heavily-audited code has shipped latent, not-yet-discovered
vulnerabilities. For a protocol that *custodies money*, "immutable forever" means
that when — not if — such a bug surfaces, there is no way to patch it and funds
can be drained faster than any social response.

So a recovery/patch capability on the value-bearing contracts is prudent, and for
production arguably necessary. **But upgradeability does not remove the risk — it
relocates it.** It converts "an unfixable code bug" into "the upgrade key is now a
god-mode lever that can itself drain or cheat." The real design question is
therefore not *upgradeable: yes/no*, but **upgradeable + which guardrails**, and
which recovery mechanism is proportionate per contract.

This RFC frames the trade-off, enumerates the realistic resolution options across
the full spectrum (not a binary), and proposes a default stance. Implementation is
deliberately deferred to child issues under the umbrella (#1300).

## Goals

- Give the fund-custody contracts a credible way to respond to a discovered
  vulnerability (stop exploitation, and/or patch the logic) before funds are lost.
- Keep that capability from becoming a *larger* attack surface than the bug it
  guards against (key compromise, malicious upgrade, silent rug).
- Preserve the value of the verification work already shipped — the blocking
  Halmos gate (#1275), the Certora specs + nightly run (#1260), and the UUPS
  storage-layout gate (#1297) — by making it a *gate on every future
  implementation*, not a one-time snapshot.
- Be explicit and per-contract: choose the *least* powerful mechanism that covers
  each contract's real failure modes.

## Non-goals

- Choosing a specific multisig/governance product, timelock duration, or signer
  set (those are follow-up decisions on #1300).
- Implementing any conversion in this RFC. This document ratifies a direction.
- Re-opening whether `ContentProtection` should be upgradeable (it already is).

## Background: current state

Recovery-lever inventory below reflects `main` after the custody-hardening work
(#1287 push-then-escrow, #1295 sweep, #1276/#1278/#1281–#1284); a checkout behind
those merges will not show `sweepBurned`/`claimFailedPayment`.

| Contract | Custodies value? | Mutability today | Existing recovery levers (admin) | Can a depositor self-exit? |
| --- | --- | --- | --- | --- |
| `ContentProtection` | yes (stakes) | **UUPS upgradeable** | upgrade; `blacklist`; `sweepBurned`; **`refundStake` is `onlyOwner`** | **No** — refund is owner-only |
| `RevenueEscrow` | yes (per-token revenue) | immutable `Ownable` | `freeze`/`unfreeze`/`redirect`; `claimFailedPayment` | **Only** once unfrozen **and** past `escrowEndTime` (`release` reverts otherwise) |
| `ShowCampaignEscrow` | yes (fan pledges) | immutable `Ownable` | `setPaused` (gates `pledge` **only** — releases still run); `cancelCampaign` → pro-rata refunds | **Only** in `RefundAvailable` (owner/threshold-gated) — not at will |
| `StemMarketplaceV2` | flow-through (per-tx) | immutable `Ownable`; `paymentAssetRegistry` is `immutable` (no setter) | `setProtocolFee`/`setFeeRecipient`; `claimFailedPayment`; `withdrawTrappedETH` | n/a (no standing deposits) |
| `StemNFT` | yes (the assets) | immutable | `setTransferValidator` / `setContentProtection` (swap the hooks) | holders own their tokens directly |
| `TransferValidator` | no (a hook) | immutable, but **swap-able** via `StemNFT.setTransferValidator` | replace the address | n/a |

Three things stand out: (1) the immutable contracts are **not defenceless** — they
hold pause/freeze/redirect/refund/swap levers; (2) the project has already built
the verification harness that makes safe upgradeability *possible*; and (3) — the
load-bearing caveat for the design below — **a depositor cannot freely withdraw on
demand from the custody contracts** (refunds are status- or owner-gated, releases
are time-locked). That last fact is what disqualifies "the timelock gives users an
exit window" as stated, and is reflected in the guardrails.

## The core trade-off

| | Immutable | Upgradeable |
| --- | --- | --- |
| Bug discovered post-deploy | cannot patch; rely on pause + migration + social exit | patch in place; users may not even notice |
| Trust assumption | trust the *verified bytecode*; it can never change | trust whoever holds the upgrade authority, *forever* |
| Worst case | a code bug drains funds before migration | a compromised/malicious authority drains funds via a "fix" |
| Verification meaning | proofs hold for the life of the contract | proofs hold only for the *current* implementation |
| Failure mode | technical (exploit) | governance/operational (key, process, intent) |

Immutability is genuinely a *security feature* — it is why some protocols make
their core vaults unchangeable. But it trades the ability to survive an unknown
bug for that guarantee. Upgradeability buys survivability at the cost of a standing
trusted party. Neither is free; the engineering question is how to get
survivability **without** an unguarded god-mode.

### On "open source vs. closed behind a firewall"

The asymmetry raised is real: an on-chain contract hands attackers the full code
and a permanent, externally-reachable surface, whereas a closed system forces them
to first find a way in. Obscurity does raise the attacker's cost. But it is a
weak, non-durable control — closed systems are breached constantly, and on-chain
you *cannot* hide the bytecode regardless. The on-chain answer to an exposed
surface is therefore not secrecy but **layered verification + the ability to
respond**: prove as much as possible (formal methods), narrow the surface
(minimal, audited code), and keep a guarded patch/stop path for the residual that
proofs cannot cover. This RFC is about that last clause.

## Resolution options (the spectrum)

Ordered from least to most powerful. They are **composable** — a contract can have
a circuit breaker *and* a guarded upgrade path.

### 1. Stay immutable (status quo)
- **Mechanism:** no upgrade; redeploy + migrate if ever needed.
- **Pros:** maximal trust-minimisation; verification holds forever; smallest
  governance surface.
- **Cons:** a discovered bug is unfixable in place; migration is slow, lossy, and
  may be front-run by the exploit.
- **Fit:** contracts with a tiny surface and a clean swap/migration path
  (`TransferValidator`), or where collector trust outweighs patchability.

### 2. Circuit breaker / pause (emergency stop)
- **Mechanism:** `pause()` halts state-changing flows (deposits, buys, releases)
  without changing logic; admin-only, ideally *fast* (no timelock).
- **Pros:** stops the bleeding within one block; logic is untouched so it cannot
  *introduce* a vulnerability; cheap to add.
- **Cons:** does not *fix* the bug; an over-broad pause can also freeze honest
  users' funds; needs a clear un-pause / resolution path. **And a too-narrow pause
  is a false sense of safety** (see below).
- **Fit:** every value contract — but it must cover the **payout/release outflow**,
  not just inflows. The existing levers are only *partial*: `ShowCampaignEscrow.setPaused`
  gates only `pledge`, so `releaseDeposit`/`releaseFunds` still execute while paused;
  `RevenueEscrow.freeze` covers releases but is per-escrow, not a global stop. A
  circuit breaker that does not halt the main custody outflow is not an emergency
  stop. **A real fast lever — covering the release/payout transitions — should be the
  universal control regardless of the upgrade decision.**

### 3. Fund rescue / migration hooks
- **Mechanism:** admin can move at-risk funds to a safe address or a new contract
  version (e.g. `freeze` + `redirect`; pause + sweep-to-new-version).
- **Pros:** recovers value even when logic is frozen; bounded, auditable.
- **Cons:** the rescue path is itself a powerful admin capability (a redirect *is*
  a fund move) — must be tightly scoped and, ideally, also timelocked or
  dispute-gated.
- **Fit:** the escrows already lean on this (`RevenueEscrow.redirect`,
  `ShowCampaignEscrow` refunds). Worth generalising.

### 4. Swappable modules (point to a new address)
- **Mechanism:** keep the contract immutable but make its *dependencies* replaceable.
  The seams that exist today: `StemNFT.setTransferValidator`,
  `StemNFT.setContentProtection`, and `ContentProtection.setPaymentAssetRegistry`.
- **Pros:** upgrades behaviour at the seams without a proxy or storage-layout risk;
  the swapped-in module is itself fresh, verifiable code.
- **Cons:** only covers logic that lives behind a seam; the core contract's own
  bug is still unpatchable. **Note:** `StemMarketplaceV2.paymentAssetRegistry` is
  `immutable` with no setter — the marketplace *cannot* swap that dependency today,
  which is one concrete reason it leans toward UUPS (option 5) rather than this one.
- **Fit:** already the pattern for `TransferValidator`. Prefer this over full
  upgradeability wherever a clean seam exists.

### 5. Full upgradeability (UUPS proxy) — with sub-variants on *authority*
The capability is the same (replace the implementation); the security is almost
entirely determined by **who** may call it and **how**:

- **5a. Owner = EOA.** *Rejected for custody.* A single hot key with god-mode over
  user funds. This is the shape most "upgrade rug" incidents take.
- **5b. Owner = multisig.** Removes the single point of compromise; still *instant*,
  so a compromised quorum (or insider) can upgrade-and-drain in one transaction
  with no warning.
- **5c. Owner = multisig + `TimelockController`, plus a fast pause and a guardian
  veto.** **Recommended baseline.** Upgrades are *proposed* and execute only after a
  public delay (e.g. 24–72h), during which the change is visible on-chain and the
  new implementation is re-verified by the gates below. **Important correction to a
  common framing:** in *this* protocol the delay is **not** a user "exit window" —
  depositors cannot freely withdraw from the custody contracts (refunds are
  status-/owner-gated, releases are time-locked; see the current-state table). So
  the delay buys **observation + reaction by governance, not self-exit by holders**.
  To make the delay actually *protective*, it must be paired with **a guardian/quorum
  veto that can cancel a queued upgrade** (and a *separate, fast* `pause()` outside
  the timelock for an in-progress exploit). Without a veto, the timelock only
  *announces* a malicious upgrade to users who cannot act on the announcement. This
  bundle — timelock + veto + fast pause — is what makes upgradeability a net security
  gain rather than a bigger rug surface.

### 6. Diamond (EIP-2535) / beacon proxies
- **Mechanism:** modular facets / shared-beacon implementations.
- **Assessment:** more flexible, materially more complex (selector clashes, larger
  storage-discipline surface, harder to formally verify). **Not recommended** for
  this codebase's size — the complexity cost outweighs the benefit versus 5c.

## The guardrails that make upgradeability acceptable

Upgradeability (option 5) is only defensible bundled with **all** of:

1. **Timelock** on every upgrade and on the powerful admin/rescue actions, with a
   carve-out for a *fast pause*. Telegraphs intent and gives governance time to
   react. (It does **not** give depositors an exit window here — see below.)
2. **A guardian / quorum veto** that can cancel a queued upgrade during the delay.
   This is what makes the timelock *protective* rather than merely *informational*:
   because holders cannot self-exit the custody contracts, someone must be able to
   *stop* a malicious queued upgrade on their behalf. (`TimelockController` supports
   a `CANCELLER_ROLE`; assign it to an independent guardian/multisig.)
3. **Multisig / governance authority**, never an EOA. No single key is god-mode.
4. **Mandatory re-verification of each new implementation.** The proofs only cover
   the *current* bytecode, so every upgrade candidate must pass the existing gates
   before it can be proposed:
   - the blocking **Halmos** symbolic gate (#1275),
   - the **Certora** CVL specs (#1260),
   - the **storage-layout** diff gate (#1297), extended to *every* upgradeable
     contract (not just `ContentProtection`).
   This is the linchpin: it is what converts "we can change the code" into "we can
   change the code *and still hold the same safety properties*."
5. **Transparency:** upgrade proposals announced; implementations verified on the
   block explorer; an emergency-response runbook (pause first, fix on the timelock).

Without (1)–(4) — and the veto in particular, given depositors cannot self-exit —
broad upgradeability lowers security. With them, it raises it.

## Proposed per-contract stance

| Contract | Proposed posture |
| --- | --- |
| `RevenueEscrow` | **UUPS + timelock + multisig + re-verify**, keep `freeze`/`redirect` and add a fast `pause`. Strongest custody case. |
| `ShowCampaignEscrow` | **UUPS + timelock + multisig + re-verify**; **extend the fast pause to the payout/release path.** `setPaused` today gates only `pledge`, so `releaseDeposit`/`releaseFunds` still run while paused — the main custody outflow is *not* stopped. Add `whenNotPaused` (or an equivalent gate) to the release/confirm transitions. |
| `StemMarketplaceV2` | **UUPS + timelock + multisig + re-verify**, plus a fast `pause` on `buy`/`list`. |
| `ContentProtection` | Already UUPS — **add the timelock + multisig + a fast pause**; bring it under the same re-verification gate. |
| `StemNFT` | **Default: stay immutable** (collector/asset trust), rely on the swappable `TransferValidator`/`ContentProtection` seams + a marketplace-level pause. Revisit only if a core-logic patch need is identified. |
| `TransferValidator` | **Stay immutable; swap-only** (already replaceable via `StemNFT.setTransferValidator`). No proxy needed. |

Net: *"all contracts upgradeable"* is **not** the recommendation — uniform
upgradeability without guardrails would lower security, and two contracts are
better served by immutability + swap-out. The recommendation is **upgradeable
where value is custodied, behind a timelock + multisig + the re-verification
gates, with pause as the universal fast lever.**

## Rollout (high-level — details on #1300)

1. Ratify this stance (per-contract posture + guardrails).
2. Land the universal **fast pause** on the value contracts (small, low-risk; can
   precede the proxy work) — and ensure it covers the **payout/release outflow**, not
   just inflows. For `ShowCampaignEscrow` this means extending `whenNotPaused` to
   `releaseDeposit`, `releaseFunds`, and the confirm transitions that lead to release
   (today it gates only `pledge`); for `RevenueEscrow`, add a global pause alongside
   the per-escrow `freeze`.
3. Stand up the **`TimelockController` + multisig** as the upgrade/admin authority,
   with an independent **guardian holding `CANCELLER_ROLE`** (the veto).
4. Convert the escrows + marketplace to **UUPS** — *one contract per PR*, each with
   initializer + storage `__gap`, the storage-layout gate extended to it, and the
   full formal suite re-run and required. (For the marketplace, this also restores
   the ability to change `paymentAssetRegistry`, which is `immutable` today.)
5. Make the **Halmos/Certora/storage-layout gates required on every implementation
   bump** (CI policy).
6. Publish the **emergency-response runbook**.

## Risks & open questions

- **Residual trust.** Even 5c leaves a timelocked party that *could* act
  maliciously over the delay window. Because depositors **cannot self-exit** the
  custody contracts, the mitigation is the **guardian veto + fast pause**, not a
  user exit — this must be stated plainly to users, and the guardian's
  independence from the upgrade multisig is itself a trust assumption to design for.
- **Should custody contracts also gain a real escape hatch?** An alternative/
  complement to the veto is a guaranteed, upgrade-immutable user-withdraw path
  (e.g. a "drain to depositor after a grace period" that no implementation can
  remove). Heavier to design; flagged for #1300.
- **Timelock vs. speed.** A long delay protects via the veto window but slows
  legitimate fixes; the fast `pause` is what reconciles them. Pick the delay
  deliberately.
- **Verification cost per upgrade.** Making the gates *required* on every bump adds
  process weight; that is the intended trade — it is the price of safe upgradeability.
- **StemNFT immutability vs. a future need to patch transfer/royalty logic** — left
  open; revisit if such a need is identified.
- **Governance product, signer set, and delay values** — deferred to #1300.

## References

- Current contracts & security considerations: `../smart-contracts/core_contracts.md`
- Verification harness: blocking Halmos gate (#1275), Certora + Gambit CI (#1260),
  storage-layout gate (#1297)
- Custody-contract security review and fixes (#944)
- Tracking / implementation: umbrella issue #1300
