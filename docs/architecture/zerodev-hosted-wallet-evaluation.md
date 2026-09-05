# ZeroDev Hosted Wallet Evaluation

**Status:** decision recorded (2026-08-11) · **Issue:**
[#1597](https://github.com/akoita/resonate/issues/1597) · **Related:**
[#354](https://github.com/akoita/resonate/issues/354),
[#355](https://github.com/akoita/resonate/issues/355), and
[#1595](https://github.com/akoita/resonate/issues/1595)

## Decision

Do **not** migrate Resonate to ZeroDev Wallet, and do not present its social
login as a supported additional validator for existing Resonate accounts.

Keep the current Resonate-owned wallet UI and Kernel v3.1 passkey root. Treat
three attractive capabilities separately:

1. **Social authentication:** defer. The supported Wallet connector creates a
   different account shape and does not expose a way to attach its hosted
   signer to an existing Resonate account. A custom validator experiment is
   allowed only if social onboarding becomes a measured launch blocker.
2. **Recovery:** continue #354 as an on-chain Kernel recovery design. ZeroDev
   Wallet does not supersede it. Replace #354's stale package assumptions with
   a threat-modeled, testnet-proven guardian/recovery-executor slice.
3. **Fiat ramps:** evaluate independently of the wallet shell. Coinbase is the
   first candidate for Base USDC; MoonPay remains a coverage candidate. Neither
   is approved until contract-wallet compatibility, geography, costs, and
   compliance allocation are proven.

This is infrastructure/quality work (`vision:keep`). It is neutral across
Business Model v2 revenue lines and changes no fee, split, payout, or product
price.

## Why the hosted wallet is not an add-on to today's account

Resonate currently creates a Kernel v3.1 / EntryPoint v0.7 account in the
browser with a WebAuthn passkey as the sudo (root) validator. The app owns the
wallet experience, while scoped agent/session permissions are reconstructed by
the backend. Relevant implementation points are:

- [`AuthProvider.tsx`](../../web/src/components/auth/AuthProvider.tsx) creates
  the passkey-root account;
- [`x402KernelAccount.ts`](../../web/src/lib/x402KernelAccount.ts) derives the
  same account shape for payment signing;
- [`kernel_account.service.ts`](../../backend/src/modules/identity/kernel_account.service.ts)
  and [`zerodev_session_key.service.ts`](../../backend/src/modules/identity/zerodev_session_key.service.ts)
  handle scoped permission accounts, not root recovery;
- [`social_recovery.service.ts`](../../backend/src/modules/identity/social_recovery.service.ts)
  is an in-memory administrative placeholder. It installs no on-chain module,
  persists no guardian configuration, proves no guardian identity, and rotates
  no root key.

ZeroDev Wallet is a separate hosted-key product, even when its optional UI kit
is not used. Its current connector source hardcodes Kernel v3.3. In ERC-4337
mode it creates a new counterfactual Kernel account with the hosted EOA as the
ECDSA sudo validator; in ERC-7702 mode it delegates that EOA. The connector
does not accept an existing account address, Kernel version, sudo/regular
plugin, or plugin manager. Consequently, its supported API does not preserve
or reuse an existing Resonate v3.1 passkey-root account.

Kernel can have one sudo validator and regular validators, so protocol-level
coexistence is plausible. It is not a documented Wallet integration, however.
The legacy `@zerodev/social-validator` integration uses Magic and is a separate
product; it is not evidence that the current Wallet/Turnkey signer can safely
be installed on Resonate's existing account.

**Conclusion:** do not turn an undocumented composition into a production
dependency. If tested later, the passkey must remain root, the hosted signer
must be removable regular authority with an explicit policy, and the account
address must not change.

## Authentication, custody, and shutdown

### What is currently supported

The hook SDK supports a fully custom Resonate UI; the prebuilt UI kit is
optional. Current documented authentication methods are:

- passkey;
- email OTP;
- email magic link;
- Google OAuth.

Google is the only OAuth provider exposed by the current public SDK source.
Older social-validator material and launch references to more providers should
not be treated as current Wallet capability.

ZeroDev describes the hosted key as generated and used in a trusted execution
environment (TEE). The signing service returns signatures; it is not described
as an MPC or key-share scheme. Users can ask a secure Turnkey-backed iframe to
display a seed phrase or private key without passing the material through the
application.

### What export does not guarantee

Export is real enough to justify an independent restore test, but it is not a
shutdown-independent recovery guarantee. The Wallet terms warn that a user who
has not exported before Turnkey, Offchain/ZeroDev, or the dApp becomes
unavailable may permanently lose control. Termination provides only a limited
export window.

Export also concerns the hosted EOA key. It does not prove continued control of
Resonate's existing passkey-root Kernel account, because the supported Wallet
flow creates a different account shape.

Any future hosted-key pilot must therefore prove all of the following before
user funds are accepted:

- export both seed phrase and private key through production-like UI;
- restore outside ZeroDev and sign without ZeroDev services;
- document which address and on-chain authority the export controls;
- exercise an outage and exhausted-credit path;
- give users a prominent export prompt and an operator-tested exit runbook;
- obtain contractual retention, termination, incident, and export-window
  commitments.

## Cost model

Checked against public pricing on 2026-08-11. Wallet is included in every plan.
The public metering is 10 credits for an off-chain signature, 20 for a UserOp,
and 30 for a sign-and-send operation.

| Plan | Monthly price | Included credits | Environment | Sign + send capacity |
| --- | ---: | ---: | --- | ---: |
| Sandbox | $0 | 10,000 | testnet only | 333 |
| Launch | $69 | 100,000 | mainnet | 3,333 |
| Scale | $399 | 1,000,000 | mainnet | 33,333 |
| Enterprise | custom | custom | mainnet | custom |

Capacity is `floor(included credits / 30)` and excludes standalone signatures,
retries, failed/replaced operations that are metered, and other ZeroDev usage.
The current page lists an 8% gas-sponsorship premium. It publishes neither a
dollar gas cap nor a paid overage price per credit; those require a written
quote. The issue's earlier `$10/month` cap and historical per-credit figures
must not be used as current commitments.

Because the launch cohort size is not yet fixed, the following is an
illustrative sensitivity table, not a forecast. “Light” assumes 10 sign-and-send
operations per active user per month; “active” assumes 25.

| Active users | Light credits | Active credits | Included plan that fits light | Included plan that fits active |
| ---: | ---: | ---: | --- | --- |
| 25 | 7,500 | 18,750 | Launch (mainnet) | Launch |
| 100 | 30,000 | 75,000 | Launch | Launch |
| 500 | 150,000 | 375,000 | Scale, or quoted Launch overage | Scale, or quoted Launch overage |
| 1,000 | 300,000 | 750,000 | Scale | Scale |

The public documentation does not assign a credit charge to login itself.
Budget only the documented signing and UserOp charges, then measure real
traffic. On Sandbox, signing pauses when credits run out until the monthly
refresh; export remains available. Paid plans continue with unspecified
overage billing. This failure mode alone makes a hosted signer inappropriate
as the only root authority.

## Recovery and disposition of #354

ZeroDev's current Kernel recovery documentation still describes recovery as a
regular guardian validator plus a recovery executor. It supports self-recovery
or dApp-assisted recovery, and the hosted recovery portal is explicitly a
convenience: a guardian can interact on-chain if the portal disappears. This is
separate from the new hosted Wallet's authentication and key export.

Therefore #354 remains the right tracker, but its implementation proposal is
not ready to execute:

- do not depend on the stale `@zerodev/recovery` package or an unverified
  `useKernelAccountRecovery` hook;
- do not assume an ECDSA-root example can replace Resonate's passkey root;
- do not make Resonate support staff a unilateral guardian;
- do not call the current admin/in-memory endpoints “recovery” in product copy.

Before implementation, #354 should require:

1. a recovery threat model covering guardian compromise, account takeover,
   lost guardian, replay, front-running, coercion, operator compromise, and
   recovery cancellation;
2. a supported Kernel v3.1 / EntryPoint v0.7 module composition that preserves
   the deployed account address and restores a WebAuthn root (or an explicitly
   reviewed successor root type);
3. self-recovery or threshold guardians by default, with delay, notification,
   cancellation, rotation, and removal semantics;
4. Base Sepolia tests from setup through loss simulation, recovery, old-root
   rejection, new-root use, and portal-independent execution;
5. persistent state and authenticated proofs; removal or honest relabeling of
   the placeholder endpoints and wallet copy;
6. a security review before mainnet and an end-user guide that accurately
   explains recovery limits.

The social-login question can be tested inside #354 only if it is one candidate
guardian factor. It must not expand #354 into a hosted-wallet migration.

## Fiat on/off-ramp shortlist

Ramp selection is independent because Resonate already models configurable
`onramp` and `offramp` funding options in
[`payments.ts`](../../web/src/lib/payments.ts), and the stablecoin architecture
already prioritizes Base USDC while keeping the provider configurable.

| Decision dimension | Coinbase Onramp / Offramp | MoonPay |
| --- | --- | --- |
| Base USDC evidence | An official onramp example explicitly pairs USDC with Base; buy and sell capability still requires a production query per geography | MoonPay supports Base generally, but public ramp sources do not establish USDC on Base for buy or sell; the current sell list omits it |
| Integration | Hosted session URL; limited headless onramp; hosted offramp | Mature hosted widget/URL; broader payment UX; newer headless path has preview/partner dependencies |
| Kernel account | Arbitrary destination-address shape is promising, but delivery to a deployed or counterfactual Kernel address is not guaranteed; ERC-1271 compatibility matters if wallet-signature authentication is chosen | Address shape and off-ramp transfer flow appear compatible, but contract-wallet support is not guaranteed |
| Off-ramp | Account and linked-payment requirements depend on the cash-out method and geography; ACH requires a Coinbase account with linked bank details | Wider advertised payout methods, with geography and asset restrictions |
| Public fee signal | Quote includes spread, Coinbase fee, and network fee; zero-fee USDC is a program that requires Coinbase approval | Variable user fee, possible embedded spread, separately disclosed network fee, and optional ecosystem fee; final quote is authoritative |
| Test limitation | Mock/sandbox flow does not prove real Base Sepolia settlement | Test mode does not list Base Sepolia |

**Shortlist recommendation:** evaluate Coinbase first for a Base-USDC pilot.
Keep MoonPay as a fallback for geography/payment-method coverage only after its
capability API or a vendor commitment confirms Base USDC separately for buy and
sell. Do not select either provider from documentation alone.

The provider decision must pass these gates:

1. Query production capability for Base USDC, buy and sell, in each launch
   geography.
2. Vendor-confirm delivery to a deployed and counterfactual Kernel contract
   address and prove a low-value receipt. Separately prove that an off-ramp
   accepts a Kernel-origin ERC-20 transfer/UserOp and that its exact/minimum
   amount and deposit-address rules pass the production paymaster policy.
3. Compare delivered quote totals including spread, payment/provider/network
   fees, and subsidies. Separately compare approval/decline rates, limits,
   chargeback allocation, payout timing, and settlement SLAs.
4. Review KYC reuse, sanctions/AML responsibility, consumer disclosures,
   privacy roles and DPA, data retention, support, suspension, and termination.
5. Keep secret credentials, URL signatures, and session creation server-side;
   expose only identifiers the vendor explicitly designates as publishable.
   Authenticate the caller, bind destination/user/amount, pass accurate client
   metadata, verify webhooks, and rate-limit abuse.
6. Exercise expired, late, underfunded, overfunded, duplicate, and failed
   off-ramp deposits. Reconcile the resulting webhooks and document who can
   recover funds when an order fails after a Kernel transfer.

The ramp provider performs its own KYC and transaction controls, but that does
not settle Resonate's legal position. #1595-A remains the launch gate for
jurisdiction, data-controller, sanctions/AML, consumer-protection, and support
responsibilities.

No new ramp implementation issue is opened by this spike. #1595-A remains the
durable tracker until the owner defines the launch cohort and geographies and
prioritizes fiat funding. At that point, open a provider-selection proof issue
with the gates above; do not hide it inside #354 or a wallet-migration task.

## Arbitrum promotion

The official `ARBZERODEV` announcement dated 2026-07-27 offers Arbitrum teams
three free months of the then-named Growth plan, with 100,000 credits, gas
sponsorship, and bundler access. It requires a billing subscription, payment
card, and promo code, and states a 2026-08-22 expiry. The offer does not state
that Base workloads qualify. “Growth” also predates the current public
“Launch” plan name, so the plans must not be silently equated.

Resonate deploys to Base. The promotion therefore does not change this decision
and is not a reason to add an Arbitrum deployment.

## Re-evaluation triggers

Revisit the no-migration decision only when all of these are true:

- ZeroDev Wallet has operated as a generally available product for two full
  quarters with stable packages, documentation, status history, and pricing;
- ZeroDev documents and supports attaching a hosted signer to an existing
  Kernel account, including v3.1/passkey-root coexistence or a reviewed account
  upgrade that preserves address and assets;
- an independent test verifies export, external restore, outage behavior,
  credit exhaustion, validator removal, and passkey fallback;
- production-volume quotes and contract terms make the TEE/KMS, billing,
  termination, data processing, incident response, and support dependencies
  acceptable;
- measured onboarding or recovery failures show that the expected benefit is
  worth changing a critical identity surface.

Pricing changes alone, a chain-specific promotion, or an optional hosted UI are
not sufficient triggers.

## Evidence and confidence

Primary sources were checked on 2026-08-11. Product and price claims can change;
the linked sources must be rechecked before any implementation or contract.

| Claim | Evidence | Confidence / limitation |
| --- | --- | --- |
| Wallet supports custom hook UI and passkey, email OTP, magic link, Google OAuth | [Wallet overview](https://docs.zerodev.app/wallets), [quickstart](https://docs.zerodev.app/wallets/quickstart), [public SDK](https://github.com/zerodevapp/zerodev-wallet-sdk) | High for current public release |
| Supported connector creates its own v3.3/ECDSA or 7702 account rather than attaching to Resonate's v3.1 account | [Connector source](https://github.com/zerodevapp/zerodev-wallet-sdk/blob/b5b56b0b898221c9ff183e111b7a27d9c3d88ad7/packages/react/src/core/connector.ts#L157-L177) | High for this pinned revision; future APIs may change |
| TEE-held key can be exported through a secure iframe | [Wallet security description](https://docs.zerodev.app/wallets), [export documentation](https://docs.zerodev.app/wallets/export) | High for documented mechanism; independent restore not yet tested by Resonate |
| Availability loss before export can cause permanent loss | [ZeroDev Wallet terms](https://www.zerodev.app/terms-of-service) | High for contractual warning; exact wind-down period needs contract review |
| Kernel recovery remains a guardian validator/executor pattern; portal is optional | [SDK recovery](https://docs.zerodev.app/advanced/account-recovery/sdk-recovery), [portal](https://docs.zerodev.app/advanced/account-recovery/portal) | High for documented pattern; Resonate compatibility untested |
| Current plans and credit rates | [pricing](https://www.zerodev.app/pricing), [Wallet metering](https://docs.zerodev.app/wallets) | High as of check date; overage and gas-cap dollars unpublished |
| Base and Base Sepolia are supported ZeroDev networks | [supported chains](https://docs.zerodev.app/api-and-toolings/faqs/chains) | High for infrastructure; not proof of Wallet/account compatibility |
| `ARBZERODEV` is an expiring offer for Arbitrum teams, not stated to cover Base | [Arbitrum announcement](https://blog.arbitrum.io/zerodev/) | High for published terms; old Growth naming does not map cleanly to the current Launch plan |
| Coinbase has an explicit Base-USDC onramp example and describes Base and USDC across its ramp products | [Coinbase Onramp overview](https://docs.cdp.coinbase.com/onramp/introduction/welcome), [v2 session API](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/onramp/create-an-onramp-session) | Medium-high for onramp; buy and sell must be confirmed separately for each geography |
| MoonPay has broader hosted payment UX but public sources do not establish Base-USDC buy or sell support | [MoonPay supported currencies](https://dev.moonpay.com/widget/supported-currencies), [sell support](https://support.moonpay.com/en/articles/384277-how-do-i-sell-cryptocurrency-with-moonpay) | Medium; current sell list omits Base USDC, and both directions require a capability/vendor check |
| Neither ramp is proven with a Kernel account | [Coinbase reference](https://docs.cdp.coinbase.com/onramp/reference), [MoonPay wallet object](https://dev.moonpay.com/api-reference/platform/objects-and-types/wallet) | Medium; absence of a guarantee is not proof of incompatibility |

## Deliberate non-goals

- no wallet migration or replacement of Resonate's passkey flow;
- no social-login, recovery, ramp, or Arbitrum deployment implementation;
- no claim that the current recovery placeholder protects user funds;
- no fee/split change and no assumption that a promotional offer applies to
  Base.
