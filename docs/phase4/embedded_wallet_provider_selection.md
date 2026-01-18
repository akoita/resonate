# Phase 4: Embedded Wallet Provider Selection

## Decision
**Primary choice:** **Privy**  
**AA stack:** **Safe{Core} 4337** (primary) or **Kernel** (alt)  
**Bundler/Paymaster:** **Pimlico** (primary) or **Alchemy** (alt)

## Rationale (why Privy)
- Best‑in‑class **consumer onboarding UX** (email/social/passkeys).
- Mature embedded wallet UX with **fast integration**.
- Strong product fit for **music streaming** (low friction is critical).
- Supports hybrid flows (embedded + external wallet) without forcing lock‑in.

## Alternatives & when to use them
- **Turnkey**: highest security posture for key management + policies; use if we
  need maximum compliance/controls and can invest in custom UX.
- **Web3Auth**: strong MPC core + open ecosystem; use if we need lower vendor
  lock‑in at the cost of more integration effort.
- **Dynamic**: good multi‑wallet orchestration; use if we want to emphasize
  external wallet compatibility from day 1.
- **Coinbase Smart Wallet**: best if we commit hard to Base as the primary chain.

## Requirements we will enforce
1. **Non‑custodial** or user‑controlled key share (documented custody model).
2. **Key export / migration** path (avoid permanent lock‑in).
3. **Passkey support** for recovery.
4. **ERC‑4337 support** with deterministic smart account address.
5. **Gas sponsorship** support (paymaster, quotas, caps).

## Next steps (implementation)
1. Implement Privy auth + wallet onboarding.
2. Wire smart accounts (Safe/Kernel) using 4337.
3. Integrate paymaster + bundler for gasless flows.
4. Add recovery + key export UX.

## Risks & mitigation
- **Vendor lock‑in** → require export/migration path in the UX.
- **AA infra outages** → multi‑bundler fallback.
- **Recovery abuse** → passkeys + guardian policy.
