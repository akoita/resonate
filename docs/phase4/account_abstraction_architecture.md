# Phase 4: Account Abstraction Architecture (Deep Research Summary)

## Goals
- Best-in-class UX: gasless onboarding, session keys, social recovery.
- Best-in-class DevX: predictable SDKs, audited contracts, reliable infra.
- Future-proof: support emerging proposals beyond ERC-4337.

## Standards Landscape (2024/2025)
- **ERC-4337**: Production standard for smart accounts (bundlers + paymasters).
- **ERC-6492**: Counterfactual signature validation for undeployed accounts.
- **EIP-7702**: EOA upgrade path (in-flight in ecosystem; plan for adoption).
- **EIP-3074**: Historical proposal for account abstraction; not the main path.

## Ecosystem Options (Smart Accounts)
- **Safe{Core} 4337**: Most audited, strong security posture, ecosystem maturity.
- **Kernel/Modular AA**: Highly composable validators and session keys.
- **Biconomy**: Strong paymaster + SDK story, good UX for gasless flows.
- **ZeroDev**: Good developer experience for 4337 stacks.
- **Alchemy AA**: Good infra/bundler and SDK, strong DX.

## Recommended Approach
1. **Primary standard:** ERC-4337 smart accounts.
2. **Signature strategy:** Support ERC-6492 for counterfactual onboarding.
3. **Account stack:** Start with Safe 4337 or Kernel; choose by target UX:
   - Safe: most robust, audited, safest for mainnet launch.
   - Kernel: superior session keys + modular validation UX.
4. **Infra:** Pimlico/Alchemy/Biconomy bundler + paymaster.
5. **UX features:**
   - Social recovery (optional in v1)
   - Session keys for AI agent playback
   - Gas sponsorship for small payments
   - Deterministic account addresses (Create2)

## Implementation Plan (v1)
- Add wallet provider abstraction with `local` and `erc4337` adapters.
- Store AA metadata in DB: `accountType`, `provider`, `entryPoint`, `factory`,
  `paymaster`, `bundler`, `salt`, `ownerAddress`.
- Generate deterministic addresses for smart accounts (Create2-style) until
  on-chain deployment is wired.
- Add admin endpoints to rotate paymaster/bundler configs.
- Add admin endpoints to switch provider and refresh account metadata.

## Next Implementation Steps
- Integrate chosen SDK (Safe or Kernel) in a dedicated `wallet_provider`.
- Implement bundler/paymaster client to submit UserOperations.
- Add ERC-6492 signature support for pre-deploy verification.
- Add session key issuance flow for agentic playback.
