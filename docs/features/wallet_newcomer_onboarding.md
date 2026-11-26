---
title: "Wallet for newcomers: welcome test money, plain wallet page, account menu"
status: implemented
owner: "@akoita"
issue: 2720
---

# Wallet for newcomers

Issue [#2720](https://github.com/akoita/resonate/issues/2720). Vision-neutral
infrastructure/quality (ADR-BM-6): test money only, no real-money flow.

## What a newcomer sees

- **Welcome test money.** On sign-up the backend sends each new account, once,
  a small amount of test USDC (to back a show) and optionally a little ETH for
  network fees. A welcome toast says what the money is for, in plain words.
- **Wallet page in plain words.** One balance in dollars (stablecoin balances
  added up), a "Test money" badge on test networks, a line about fees, and a
  "Start here" card: find a show, back it, get it back if it doesn't happen.
  Address, passkey and account details sit under a folded "Technical details".
- **Get my test money.** When a welcome leg did not arrive (failed send,
  daily limit, or an account made before welcome money existed), the card
  offers a button that claims it once.
- **Account menu.** The sidebar account card opens a menu: Profile (artist
  page for artists, Settings > Community for listeners), Wallet (only while the
  wallet switch is on), Settings, Sign out.

## Rules the faucet keeps

| Rule | Where |
| --- | --- |
| Each leg (ETH, test USDC) at most once per account and wallet; a failed leg may be retried | `SignupFaucetAttempt` unique key + `purpose` |
| At most `SIGNUP_FAUCET_DAILY_LIMIT` accounts per UTC day (default 25, `0` pauses) | `SignupFaucetService.fund` |
| Only test networks pay (Base Sepolia, Sepolia, Anvil), whatever the config says | `FAUCET_TEST_CHAIN_IDS` |
| Claims only go to the address sign-in verified for the caller | `findVerifiedWallet` |
| Claim route behind the `wallet` switch, signed-in only, 3 per minute | `WelcomeFundsController` |
| A failed send's raw error is never returned to the browser | `WelcomeFundsController.claim` |

The faucet signs plain transfers with a funding key read from the secret
manager; it adds no signing or key-handling code to user wallets, which stay on
the existing passkey smart-account stack.

## Configuration

`SIGNUP_FAUCET_ENABLED`, `SIGNUP_FAUCET_AMOUNT_ETH`, `SIGNUP_FAUCET_USDC_AMOUNT`,
`SIGNUP_FAUCET_USDC_TOKEN_ADDRESS`, `SIGNUP_FAUCET_DAILY_LIMIT`,
`SIGNUP_FAUCET_FUNDER_PRIVATE_KEY`: see `docs/deployment/environment.md`.
Deployment values live in `resonate-iac`.

## Tests

- `backend/src/tests/signup_faucet.service.spec.ts` (USDC leg, daily limit,
  test-network guard, claim and status)
- `backend/src/tests/welcome_funds.controller.spec.ts`
- `backend/src/tests/product_surface_routes.spec.ts` (wallet switch gate)
- `web/src/lib/walletPlainWords.test.ts`
- `web/tests/wallet.authenticated.spec.ts` (WALLET-01..05)
