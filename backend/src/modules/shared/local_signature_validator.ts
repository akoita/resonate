/**
 * The local chain (Anvil) and the UniversalSigValidator this repository deploys
 * there. The canonical ERC-6492 validators do not exist on Anvil, so every
 * smart-account signature check (sign-in, account-closure step-up, x402 payer
 * binding) points viem at this one when it verifies on the local chain.
 */
export const LOCAL_CHAIN_ID = 31337;
export const LOCAL_UNIVERSAL_SIG_VALIDATOR = "0xA51c1fc2f0D1a1b8494Ed1FE312d7C3a78Ed91C0" as const;
