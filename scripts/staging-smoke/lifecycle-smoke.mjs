#!/usr/bin/env node
// Staging lifecycle smoke (#1392).
//
// Walks the full Shows money path against the REAL staging deployment:
// on-chain create/activate (deployer key) -> API draft/authority/activate as an
// operator -> pledge intent + on-chain approve/pledge (smoke wallet) -> indexer
// confirmation -> then, by RELEASE_MODE:
//   auto (default): cancelCampaign + claimRefund — tests the refund seam end to
//     end, restores the smoke wallet's USDC (only gas burns), and ends the
//     campaign in a discovery-excluded state (#1357) so nothing lingers.
//   full: confirmBooking -> confirmFulfillment -> wait the real dispute window
//     (1h contract minimum) -> releaseFunds + fee/settlement assertions.
//   skip: stop after the indexer leg (leaves the campaign Funded — warned).
//
// It converts the Sprint-2 manual UAT into infrastructure: every seam that a
// regression could break (JSON serialization #1386, payment-token chain-truth
// #1364/#1391, fee hydration, the indexer leg) is asserted here, and any break
// exits non-zero with a one-line `SMOKE_FAIL <step>: <reason>`.
//
// Dependency: viem only. Node 20+ (global fetch, top-level await).
//
// Env contract (see docs/features/staging_lifecycle_smoke.md):
//   API_BASE                        required  e.g. https://api-staging.resonate.pydes.xyz
//   RPC_URL                         required  Base Sepolia JSON-RPC
//   SHOW_CAMPAIGN_ESCROW_ADDRESS    required  deployed escrow
//   PAYMENT_TOKEN                   required  USDC (6 decimals)
//   CONTRACT_DEPLOYER_PRIVATE_KEY   required  escrow owner (create/activate/confirm/release)
//   SMOKE_WALLET_PRIVATE_KEY        required  pre-funded EOA that pledges + authenticates
//   SMOKE_BENEFICIARY               optional  default platform test smart account
//   SMOKE_ARTIST_DISPLAY_NAME       optional  catalog artist the draft credits (default "Smoke Test Artist")
//   SMOKE_ARTIST_ID                 optional  explicit catalog artistId (skips display-name catalog lookup)
//   EXPECTED_CHAIN_ID               optional  default 84532
//   PLEDGE_UNITS                    optional  default 1000000 (1 USDC)
//   GOAL_UNITS                      optional  default 1000000
//   EXPECTED_FEE_BPS                optional  default 600 (6%)
//   DISPUTE_WINDOW_SECONDS          optional  default 3600 (contract MIN_DISPUTE_WINDOW)
//   MIN_USDC_UNITS                  optional  default 2000000 (2 USDC)
//   MIN_GAS_WEI                     optional  default 2000000000000000 (0.002 ETH)
//   RELEASE_MODE                    optional  auto|full|skip (default auto)
//                                             auto: cancel + refund loop (fast, self-cleaning, ~0 USDC net)
//                                             full: booking/fulfillment/release fee leg (>1h: waits
//                                                   out the contract-minimum 1h dispute window)
//                                             skip: stop after the indexer leg (campaign left Funded)
//   INDEXER_TIMEOUT_MS              optional  default 180000 (3 min) bound on indexer polling
//   SETTLED_TIMEOUT_MS              optional  default 120000 (2 min) bound on settled polling
//   REFUND_TIMEOUT_MS               optional  default 180000 (3 min) bound on refund-state polling
//
// Flags: --dry-run stops cleanly after preflight + auth (no campaign burned).

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  parseAbi,
  decodeEventLog,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

// ---------------------------------------------------------------------------
// Config + tiny helpers
// ---------------------------------------------------------------------------

const DRY_RUN = process.argv.includes("--dry-run");
const RUN_ID = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
  : `${Date.now()}`;
const FAUCET_URL = "https://faucet.circle.com";

function req(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new SmokeError("preflight", `missing required env ${name}`);
  return value;
}
function num(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = BigInt(raw);
  return parsed;
}
function int(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return Number.parseInt(raw, 10);
}

class SmokeError extends Error {
  constructor(step, reason) {
    super(reason);
    this.step = step;
  }
}

const started = Date.now();
const timings = [];
const txHashes = {};

function ok(step, since, extra) {
  const ms = Date.now() - since;
  timings.push({ step, ms });
  console.log(`[smoke] ${step} OK (${ms}ms)${extra ? ` — ${extra}` : ""}`);
}
function info(step, message) {
  console.log(`[smoke] ${step} … ${message}`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchJson(url, init, step) {
  let res;
  try {
    res = await fetch(url, init);
  } catch (err) {
    throw new SmokeError(step, `request to ${url} failed: ${err.message}`);
  }
  const text = await res.text();
  if (!res.ok) {
    throw new SmokeError(step, `${init?.method ?? "GET"} ${url} -> ${res.status}: ${text.slice(0, 300)}`);
  }
  // #1386 regression is implicitly covered: every API response must parse as JSON.
  try {
    return text ? JSON.parse(text) : {};
  } catch {
    throw new SmokeError(step, `${url} returned non-JSON body: ${text.slice(0, 200)}`);
  }
}

function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

function decodeJwtRole(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new SmokeError("auth", "JWT is not a well-formed token");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  return payload.role;
}

// ---------------------------------------------------------------------------
// Minimal escrow + ERC-20 ABIs (fragments from
// contracts/src/core/ShowCampaignEscrow.sol + IShowCampaignEscrow.sol).
// ---------------------------------------------------------------------------

const ESCROW_ABI = parseAbi([
  "function createCampaign(bytes32 artistIdHash, bytes32 authorityHash, address beneficiary, address paymentToken, uint256 goalAmount, uint256 minimumBackers, uint256 deadline, uint256 bookingDeadline, uint256 depositReleaseBps, uint256 disputeWindowSeconds) returns (uint256 campaignId)",
  "function activateCampaign(uint256 campaignId)",
  "function pledge(uint256 campaignId, uint256 amount)",
  "function confirmBooking(uint256 campaignId)",
  "function confirmFulfillment(uint256 campaignId)",
  "function releaseFunds(uint256 campaignId)",
  "function cancelCampaign(uint256 campaignId)",
  "function claimRefund(uint256 campaignId)",
  "function campaigns(uint256) view returns (bytes32 artistIdHash, bytes32 authorityHash, address beneficiary, address paymentToken, uint256 goalAmount, uint256 minimumBackers, uint256 deadline, uint256 bookingDeadline, uint256 depositReleaseBps, uint256 disputeWindowSeconds, uint256 totalPledged, uint256 totalRefunded, uint256 totalReleased, uint256 uniqueBackers, uint256 fulfilledAt, uint8 status, uint256 feeBps, uint256 totalFeePaid)",
  "function campaignFees(uint256 campaignId) view returns (uint256 feeBps, uint256 totalFeePaid)",
  "function campaignStatus(uint256 campaignId) view returns (uint8)",
  "function feeRecipient() view returns (address)",
  "event CampaignCreated(uint256 indexed campaignId, bytes32 indexed artistIdHash, bytes32 indexed authorityHash, address beneficiary, address paymentToken, uint256 goalAmount, uint256 minimumBackers, uint256 deadline, uint256 bookingDeadline)",
]);

const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// Escrow CampaignStatus enum order (IShowCampaignEscrow.sol).
const STATUS_NAMES = [
  "Draft", "Active", "Funded", "BookingConfirmed", "DepositReleased",
  "Fulfilled", "Released", "Cancelled", "RefundAvailable", "Refunded",
];

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const API_BASE = req("API_BASE").replace(/\/$/, "");
  const RPC_URL = req("RPC_URL");
  const ESCROW = getAddress(req("SHOW_CAMPAIGN_ESCROW_ADDRESS"));
  const PAYMENT_TOKEN = getAddress(req("PAYMENT_TOKEN"));
  const BENEFICIARY = getAddress(
    process.env.SMOKE_BENEFICIARY?.trim() || "0xa5369569fd24b019923bae45db8f9c0e6bf482cb",
  );
  const EXPECTED_CHAIN_ID = int("EXPECTED_CHAIN_ID", 84532);
  const GOAL_UNITS = num("GOAL_UNITS", 1_000_000n);
  const PLEDGE_UNITS = num("PLEDGE_UNITS", 1_000_000n);
  const EXPECTED_FEE_BPS = int("EXPECTED_FEE_BPS", 600);
  const DISPUTE_WINDOW_SECONDS = int("DISPUTE_WINDOW_SECONDS", 3600);
  const MIN_USDC_UNITS = num("MIN_USDC_UNITS", 2_000_000n);
  const MIN_GAS_WEI = num("MIN_GAS_WEI", 2_000_000_000_000_000n);
  const INDEXER_TIMEOUT_MS = int("INDEXER_TIMEOUT_MS", 180_000);
  const SETTLED_TIMEOUT_MS = int("SETTLED_TIMEOUT_MS", 120_000);
  const REFUND_TIMEOUT_MS = int("REFUND_TIMEOUT_MS", 180_000);
  const RELEASE_MODE = (process.env.RELEASE_MODE?.trim() || "auto").toLowerCase();
  if (!["auto", "full", "skip"].includes(RELEASE_MODE)) {
    throw new SmokeError("preflight", `RELEASE_MODE must be auto|full|skip, got "${RELEASE_MODE}"`);
  }
  const ARTIST_DISPLAY_NAME = process.env.SMOKE_ARTIST_DISPLAY_NAME?.trim() || "Smoke Test Artist";
  const ARTIST_ID = process.env.SMOKE_ARTIST_ID?.trim() || null;

  const deployerAccount = privateKeyToAccount(normalizeKey(req("CONTRACT_DEPLOYER_PRIVATE_KEY")));
  const smokeAccount = privateKeyToAccount(normalizeKey(req("SMOKE_WALLET_PRIVATE_KEY")));

  const transport = http(RPC_URL);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const deployerWallet = createWalletClient({ account: deployerAccount, chain: baseSepolia, transport });
  const smokeWallet = createWalletClient({ account: smokeAccount, chain: baseSepolia, transport });

  const expectedFeeUnits = (PLEDGE_UNITS * BigInt(EXPECTED_FEE_BPS)) / 10_000n;
  const expectedNetUnits = PLEDGE_UNITS - expectedFeeUnits;

  // === 1. preflight =========================================================
  let smokeUsdcAtStart; // baseline for the auto-mode refund restoration assertion
  {
    const t = Date.now();
    const chainId = await publicClient.getChainId();
    if (chainId !== EXPECTED_CHAIN_ID) {
      throw new SmokeError("preflight", `RPC chainId ${chainId} != expected ${EXPECTED_CHAIN_ID}`);
    }
    const [usdc, gas] = await Promise.all([
      publicClient.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [smokeAccount.address] }),
      publicClient.getBalance({ address: smokeAccount.address }),
    ]);
    if (usdc < MIN_USDC_UNITS) {
      throw new SmokeError(
        "preflight",
        `SMOKE_WALLET_LOW_BALANCE: wallet ${smokeAccount.address} has ${usdc} USDC units (< ${MIN_USDC_UNITS}); top up test USDC at ${FAUCET_URL}`,
      );
    }
    if (gas < MIN_GAS_WEI) {
      throw new SmokeError(
        "preflight",
        `SMOKE_WALLET_LOW_BALANCE: wallet ${smokeAccount.address} has ${gas} wei gas (< ${MIN_GAS_WEI}); fund Base Sepolia ETH`,
      );
    }
    await fetchJson(`${API_BASE}/health`, undefined, "preflight");
    smokeUsdcAtStart = usdc;
    ok("preflight", t, `chain ${chainId}, usdc ${usdc}, gas ${gas}`);
  }

  // === 2. auth (smoke EOA -> operator) ======================================
  let token;
  {
    const t = Date.now();
    const address = smokeAccount.address;
    const { nonce } = await fetchJson(`${API_BASE}/auth/nonce`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    }, "auth");
    if (!nonce) throw new SmokeError("auth", "nonce endpoint returned no nonce");
    const signature = await smokeWallet.signMessage({ account: smokeAccount, message: nonce });
    const verify = await fetchJson(`${API_BASE}/auth/verify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      // Plain EOA on a non-31337 chain: address == signer, role operator.
      body: JSON.stringify({ address, message: nonce, signature, role: "operator", chainId: EXPECTED_CHAIN_ID }),
    }, "auth");
    token = verify.accessToken;
    if (!token) throw new SmokeError("auth", `verify returned no accessToken: ${JSON.stringify(verify)}`);
    const role = decodeJwtRole(token);
    if (role !== "operator") {
      throw new SmokeError("auth", `JWT role is "${role}", expected "operator" — is ${address} in OPERATOR_ADDRESSES?`);
    }
    ok("auth", t, `operator token for ${address}`);
  }

  if (DRY_RUN) {
    console.log("[smoke] --dry-run: stopped cleanly after preflight + auth");
    report({ mode: RELEASE_MODE, skipped: ["chain-create", "api-draft", "api-authority", "pledge", "indexer-confirm", "terminal leg"] });
    return;
  }

  // === 3. chain-create (deployer key) =======================================
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const deadline = nowSec + 30n * 60n;
  const bookingDeadline = nowSec + 60n * 60n;
  const artistIdHash = keccak256(toHex(`smoke:${RUN_ID}:artist`));
  const authorityHash = keccak256(toHex(`smoke:${RUN_ID}:authority`));
  let contractCampaignId;
  {
    const t = Date.now();
    const hash = await deployerWallet.writeContract({
      address: ESCROW,
      abi: ESCROW_ABI,
      functionName: "createCampaign",
      args: [
        artistIdHash, authorityHash, BENEFICIARY, PAYMENT_TOKEN,
        GOAL_UNITS, 1n, deadline, bookingDeadline, 0n, BigInt(DISPUTE_WINDOW_SECONDS),
      ],
    });
    txHashes.createCampaign = hash;
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (receipt.status !== "success") throw new SmokeError("chain-create", `createCampaign tx reverted (${hash})`);
    contractCampaignId = extractCampaignId(receipt.logs);
    if (contractCampaignId === null) throw new SmokeError("chain-create", "no CampaignCreated event in receipt");

    const activateHash = await deployerWallet.writeContract({
      address: ESCROW, abi: ESCROW_ABI, functionName: "activateCampaign", args: [contractCampaignId],
    });
    txHashes.activateCampaignChain = activateHash;
    const activateReceipt = await publicClient.waitForTransactionReceipt({ hash: activateHash });
    if (activateReceipt.status !== "success") throw new SmokeError("chain-create", `activateCampaign tx reverted (${activateHash})`);
    ok("chain-create", t, `campaignId ${contractCampaignId}`);
  }

  // === 4. api-draft (operator) ==============================================
  let backendId;
  let slug;
  {
    const t = Date.now();
    const draftBody = {
      artistDisplayName: ARTIST_DISPLAY_NAME,
      ...(ARTIST_ID ? { artistId: ARTIST_ID } : {}),
      title: `Smoke ${RUN_ID} — lifecycle test`,
      description: "Automated staging lifecycle smoke (#1392). Not a real show — safe to ignore.",
      city: "Smoke",
      country: "US",
      deadline: new Date(Number(deadline) * 1000).toISOString(),
      bookingDeadline: new Date(Number(bookingDeadline) * 1000).toISOString(),
      goalAmountUnits: GOAL_UNITS.toString(),
      minimumBackers: 1,
      paymentTokenAddress: PAYMENT_TOKEN,
      paymentAssetSymbol: "USDC",
      paymentAssetDecimals: 6,
      chainId: EXPECTED_CHAIN_ID,
      disputeWindowSeconds: DISPUTE_WINDOW_SECONDS,
      depositReleaseBps: 0,
    };
    const draft = await fetchJson(`${API_BASE}/shows/campaigns`, {
      method: "POST", headers: authHeaders(token), body: JSON.stringify(draftBody),
    }, "api-draft");
    backendId = draft.id;
    slug = draft.slug;
    if (!backendId || !slug) throw new SmokeError("api-draft", `draft missing id/slug: ${JSON.stringify(draft).slice(0, 200)}`);
    ok("api-draft", t, `backendId ${backendId}`);
  }

  // === 5. api-authority + activate ==========================================
  {
    const t = Date.now();
    await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(backendId)}/authority`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({
        authorityStatus: "artist_authorized",
        beneficiaryAddress: BENEFICIARY,
        beneficiaryType: "wallet",
        authorityCredentialId: `smoke-${RUN_ID}`,
      }),
    }, "api-authority");

    const activated = await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(backendId)}/activate`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ contractAddress: ESCROW, contractCampaignId: contractCampaignId.toString() }),
    }, "api-authority");

    // Hydration assertions — the #1364/#1391 regressions.
    assertAddressEqual("api-authority", "paymentTokenAddress", activated.paymentTokenAddress, PAYMENT_TOKEN);
    if (activated.onChainStatus !== "Active") {
      throw new SmokeError("api-authority", `onChainStatus is "${activated.onChainStatus}", expected "Active"`);
    }
    // feeBps must equal the on-chain fee (600 on staging, or whatever the chain reports).
    if (activated.feeBps !== EXPECTED_FEE_BPS) {
      throw new SmokeError("api-authority", `feeBps hydrated as ${activated.feeBps}, expected on-chain ${EXPECTED_FEE_BPS}`);
    }
    ok("api-authority", t, `activated, feeBps ${activated.feeBps}, onChainStatus Active`);
  }

  // === 6. pledge (intent via API as smoke user, then on-chain) ==============
  {
    const t = Date.now();
    // The smoke EOA's own wallet row was created by /auth/verify (upsertWalletIdentity),
    // so its bound wallet == the smoke address (#1221 rule satisfied).
    const intent = await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(backendId)}/pledges/intent`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ walletAddress: smokeAccount.address, amountUnits: PLEDGE_UNITS.toString() }),
    }, "pledge");
    if (!intent?.pledge?.id) throw new SmokeError("pledge", `intent missing pledge.id: ${JSON.stringify(intent).slice(0, 200)}`);

    // Approve exactly the pledge amount, then pledge on-chain.
    const allowance = await publicClient.readContract({
      address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [smokeAccount.address, ESCROW],
    });
    if (allowance < PLEDGE_UNITS) {
      const approveHash = await smokeWallet.writeContract({
        address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "approve", args: [ESCROW, PLEDGE_UNITS],
      });
      txHashes.approve = approveHash;
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
      if (approveReceipt.status !== "success") throw new SmokeError("pledge", `approve tx reverted (${approveHash})`);
    }
    const pledgeHash = await smokeWallet.writeContract({
      address: ESCROW, abi: ESCROW_ABI, functionName: "pledge", args: [contractCampaignId, PLEDGE_UNITS],
    });
    txHashes.pledge = pledgeHash;
    const pledgeReceipt = await publicClient.waitForTransactionReceipt({ hash: pledgeHash });
    if (pledgeReceipt.status !== "success") throw new SmokeError("pledge", `pledge tx reverted (${pledgeHash})`);
    ok("pledge", t, `pledge id ${intent.pledge.id}, tx ${pledgeHash}`);
  }

  // === 7. indexer-confirm (poll public campaign until Funded) ===============
  {
    const t = Date.now();
    const deadlineMs = Date.now() + INDEXER_TIMEOUT_MS;
    let last = null;
    while (Date.now() < deadlineMs) {
      const campaign = await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(slug)}`, undefined, "indexer-confirm");
      last = campaign;
      const funded = campaign.status === "funded" || campaign.onChainStatus === "Funded";
      if (funded && BigInt(campaign.raisedAmountUnits ?? "0") >= PLEDGE_UNITS) {
        ok("indexer-confirm", t, `status ${campaign.status}/${campaign.onChainStatus}, raised ${campaign.raisedAmountUnits}`);
        break;
      }
      if (Date.now() + 6000 >= deadlineMs) {
        throw new SmokeError(
          "indexer-confirm",
          `campaign not funded within ${INDEXER_TIMEOUT_MS}ms (status ${last?.status}/${last?.onChainStatus}, raised ${last?.raisedAmountUnits}) — indexer leg broken`,
        );
      }
      await sleep(6000);
    }
  }

  // === 8+. terminal leg — mode-dependent ====================================
  //
  // The deployed escrow enforces MIN_DISPUTE_WINDOW = 1 hour, so the release
  // (fee) leg cannot fit a fast run. Instead of leaving the campaign Fulfilled
  // forever (which would strand the smoke wallet's pledge in escrow AND leave a
  // visible test campaign in public discovery — Fulfilled is NOT in the #1357
  // discovery-excluded list), auto mode cancels and claims the refund: it tests
  // the refund seam end to end, recycles the USDC, and self-cleans. The weekly
  // full run covers the booking/fulfillment/release fee leg.

  if (RELEASE_MODE === "skip") {
    console.warn(
      `[smoke] WARNING: RELEASE_MODE=skip leaves campaign ${contractCampaignId} (backend ${backendId}) at Funded — ` +
      `it stays publicly visible (Funded is not discovery-excluded) and holds ${PLEDGE_UNITS} USDC units of the smoke wallet in escrow.`,
    );
    console.warn("[smoke] Clean up with ONE of:");
    console.warn(
      `[smoke]   refund path:  cast send ${ESCROW} "cancelCampaign(uint256)" ${contractCampaignId} --private-key $CONTRACT_DEPLOYER_PRIVATE_KEY --rpc-url $RPC_URL` +
      ` && cast send ${ESCROW} "claimRefund(uint256)" ${contractCampaignId} --private-key $SMOKE_WALLET_PRIVATE_KEY --rpc-url $RPC_URL`,
    );
    console.warn(
      `[smoke]   release path: Actions -> Smart Contract Deployment -> operation=confirm-show-campaign-booking, ` +
      `then confirm-show-campaign-fulfillment, then (after the dispute window) release-show-campaign-funds, each with campaign_id=${contractCampaignId}`,
    );
    report({ mode: RELEASE_MODE, skipped: ["cancel", "claim-refund", "backend-refund-state", "confirm+fulfill", "release", "backend-settled"], contractCampaignId, backendId, slug });
    return;
  }

  if (RELEASE_MODE === "auto") {
    // === 8. cancel (deployer key): Funded is cancellable -> RefundAvailable ==
    {
      const t = Date.now();
      const cancelHash = await deployerWallet.writeContract({
        address: ESCROW, abi: ESCROW_ABI, functionName: "cancelCampaign", args: [contractCampaignId],
      });
      txHashes.cancelCampaign = cancelHash;
      const receipt = await publicClient.waitForTransactionReceipt({ hash: cancelHash });
      if (receipt.status !== "success") throw new SmokeError("cancel", `cancelCampaign tx reverted (${cancelHash})`);
      const statusCode = Number(await publicClient.readContract({
        address: ESCROW, abi: ESCROW_ABI, functionName: "campaignStatus", args: [contractCampaignId],
      }));
      if (STATUS_NAMES[statusCode] !== "RefundAvailable") {
        throw new SmokeError("cancel", `on-chain status after cancel is ${STATUS_NAMES[statusCode] ?? statusCode}, expected RefundAvailable`);
      }
      ok("cancel", t, `campaign ${contractCampaignId} -> RefundAvailable`);
    }

    // === 9. claim-refund (smoke wallet): fee-free, restores the pledge =======
    {
      const t = Date.now();
      const claimHash = await smokeWallet.writeContract({
        address: ESCROW, abi: ESCROW_ABI, functionName: "claimRefund", args: [contractCampaignId],
      });
      txHashes.claimRefund = claimHash;
      const receipt = await publicClient.waitForTransactionReceipt({ hash: claimHash });
      if (receipt.status !== "success") throw new SmokeError("claim-refund", `claimRefund tx reverted (${claimHash})`);

      const [campaignTuple, usdcNow] = await Promise.all([
        publicClient.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "campaigns", args: [contractCampaignId] }),
        publicClient.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [smokeAccount.address] }),
      ]);
      const totalRefunded = campaignTuple[11];
      if (totalRefunded !== PLEDGE_UNITS) {
        throw new SmokeError("claim-refund", `on-chain totalRefunded ${totalRefunded} != pledged ${PLEDGE_UNITS}`);
      }
      // Refunds are fee-free: the wallet's USDC must be fully restored across
      // the whole run (delta 0 — gas is paid in ETH, not USDC).
      if (usdcNow !== smokeUsdcAtStart) {
        throw new SmokeError(
          "claim-refund",
          `smoke wallet USDC ${usdcNow} != pre-run balance ${smokeUsdcAtStart} — refund did not restore the pledge`,
        );
      }
      // With a single unique backer the claim also settles the campaign to Refunded.
      const statusCode = Number(campaignTuple[15]);
      ok("claim-refund", t, `totalRefunded ${totalRefunded}, wallet restored, on-chain status ${STATUS_NAMES[statusCode] ?? statusCode}`);
    }

    // === 10. backend-refund-state (indexer settles a discovery-excluded state)
    {
      const t = Date.now();
      // All three are excluded from public discovery by the #1357 filter.
      const REFUND_STATES = ["refund_available", "cancelled", "refunded"];
      const deadlineMs = Date.now() + REFUND_TIMEOUT_MS;
      let last = null;
      for (;;) {
        const campaign = await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(slug)}`, undefined, "backend-refund-state");
        last = campaign;
        if (REFUND_STATES.includes(campaign.status)) {
          ok("backend-refund-state", t, `status ${campaign.status} (discovery-excluded), onChainStatus ${campaign.onChainStatus}`);
          break;
        }
        if (Date.now() + 6000 >= deadlineMs) {
          throw new SmokeError(
            "backend-refund-state",
            `campaign not in a refund state within ${REFUND_TIMEOUT_MS}ms (status ${last?.status}/${last?.onChainStatus}) — refund indexer leg broken`,
          );
        }
        await sleep(6000);
      }
    }

    report({
      mode: RELEASE_MODE,
      note: "refund loop complete — USDC recycled, campaign discovery-excluded; fee/release leg is covered by the weekly full run",
      contractCampaignId, backendId, slug,
    });
    return;
  }

  // === RELEASE_MODE=full: booking -> fulfillment -> release (fee leg) =======

  // === 8. confirm + fulfill (deployer key) ==================================
  let fulfilledAtMs;
  {
    const t = Date.now();
    const bookingHash = await deployerWallet.writeContract({
      address: ESCROW, abi: ESCROW_ABI, functionName: "confirmBooking", args: [contractCampaignId],
    });
    txHashes.confirmBooking = bookingHash;
    const bookingReceipt = await publicClient.waitForTransactionReceipt({ hash: bookingHash });
    if (bookingReceipt.status !== "success") throw new SmokeError("confirm+fulfill", `confirmBooking reverted (${bookingHash})`);

    const fulfillHash = await deployerWallet.writeContract({
      address: ESCROW, abi: ESCROW_ABI, functionName: "confirmFulfillment", args: [contractCampaignId],
    });
    txHashes.confirmFulfillment = fulfillHash;
    const fulfillReceipt = await publicClient.waitForTransactionReceipt({ hash: fulfillHash });
    if (fulfillReceipt.status !== "success") throw new SmokeError("confirm+fulfill", `confirmFulfillment reverted (${fulfillHash})`);
    fulfilledAtMs = Date.now();
    ok("confirm+fulfill", t, `booking + fulfillment confirmed`);
  }

  // === 9. release ===========================================================
  // releaseFunds requires waiting `disputeWindowSeconds` after fulfillment
  // (contract minimum 1 hour). The wait is bounded by the computed window; the
  // workflow's timeout-minutes is the outer guard.
  const windowMs = DISPUTE_WINDOW_SECONDS * 1000;
  {
    const t = Date.now();
    const feeRecipient = await publicClient.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "feeRecipient" });
    const [benBefore, feeBefore] = await Promise.all([
      publicClient.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [BENEFICIARY] }),
      publicClient.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [feeRecipient] }),
    ]);

    const waitMs = Math.max(0, fulfilledAtMs + windowMs + 5_000 - Date.now());
    if (waitMs > 0) {
      info("release", `waiting ${Math.ceil(waitMs / 1000)}s for dispute window`);
      await sleep(waitMs);
    }
    const releaseHash = await deployerWallet.writeContract({
      address: ESCROW, abi: ESCROW_ABI, functionName: "releaseFunds", args: [contractCampaignId],
    });
    txHashes.releaseFunds = releaseHash;
    const releaseReceipt = await publicClient.waitForTransactionReceipt({ hash: releaseHash });
    if (releaseReceipt.status !== "success") throw new SmokeError("release", `releaseFunds reverted (${releaseHash})`);

    const [feeTuple, benAfter, feeAfter] = await Promise.all([
      publicClient.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "campaignFees", args: [contractCampaignId] }),
      publicClient.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [BENEFICIARY] }),
      publicClient.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [feeRecipient] }),
    ]);
    const totalFeePaid = feeTuple[1];
    if (totalFeePaid !== expectedFeeUnits) {
      throw new SmokeError("release", `on-chain totalFeePaid ${totalFeePaid} != expected ${expectedFeeUnits} (6% of ${PLEDGE_UNITS})`);
    }
    // beneficiary and fee-recipient may be the same address on staging; assert the
    // one that isn't overlapping. Net delta to beneficiary:
    if (getAddress(feeRecipient) !== BENEFICIARY) {
      if (benAfter - benBefore !== expectedNetUnits) {
        throw new SmokeError("release", `beneficiary delta ${benAfter - benBefore} != expected net ${expectedNetUnits}`);
      }
      if (feeAfter - feeBefore !== expectedFeeUnits) {
        throw new SmokeError("release", `feeRecipient delta ${feeAfter - feeBefore} != expected fee ${expectedFeeUnits}`);
      }
    } else if (benAfter - benBefore !== PLEDGE_UNITS) {
      // Same address receives net + fee = gross.
      throw new SmokeError("release", `combined delta ${benAfter - benBefore} != gross ${PLEDGE_UNITS}`);
    }
    ok("release", t, `totalFeePaid ${totalFeePaid}, net ${expectedNetUnits} to beneficiary`);
  }

  // 10. backend-settled
  {
    const t = Date.now();
    const deadlineMs = Date.now() + SETTLED_TIMEOUT_MS;
    let last = null;
    while (Date.now() < deadlineMs) {
      const campaign = await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(slug)}`, undefined, "backend-settled");
      last = campaign;
      if (campaign.status === "released") {
        const b = campaign.campaignFeeBreakdown ?? {};
        assertUnits("backend-settled", "totalFeePaidUnits", b.totalFeePaidUnits, expectedFeeUnits);
        assertUnits("backend-settled", "grossReleasedUnits", b.grossReleasedUnits, PLEDGE_UNITS);
        assertUnits("backend-settled", "netReleasedToArtistUnits", b.netReleasedToArtistUnits, expectedNetUnits);
        ok("backend-settled", t, `status released, fee ${b.totalFeePaidUnits}, net ${b.netReleasedToArtistUnits}`);
        report({ mode: RELEASE_MODE, contractCampaignId, backendId, slug, expectedFeeUnits, expectedNetUnits, BENEFICIARY });
        return;
      }
      if (Date.now() + 6000 >= deadlineMs) {
        throw new SmokeError("backend-settled", `campaign not released within ${SETTLED_TIMEOUT_MS}ms (status ${last?.status}) — indexer settlement leg broken`);
      }
      await sleep(6000);
    }
  }
}

// ---------------------------------------------------------------------------
// Assertion + report helpers
// ---------------------------------------------------------------------------

function normalizeKey(key) {
  const k = key.startsWith("0x") ? key : `0x${key}`;
  return k;
}

function extractCampaignId(logs) {
  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: ESCROW_ABI, data: log.data, topics: log.topics });
      if (decoded.eventName === "CampaignCreated") return decoded.args.campaignId;
    } catch {
      // not our event
    }
  }
  return null;
}

function assertAddressEqual(step, field, actual, expected) {
  if (!actual) throw new SmokeError(step, `${field} is missing on the API response`);
  if (getAddress(actual) !== getAddress(expected)) {
    throw new SmokeError(step, `${field} is ${actual}, expected ${expected}`);
  }
}

function assertUnits(step, field, actual, expected) {
  if (actual === undefined || actual === null) throw new SmokeError(step, `${field} is missing`);
  if (BigInt(actual) !== expected) {
    throw new SmokeError(step, `${field} is ${actual}, expected ${expected}`);
  }
}

function report(summary) {
  console.log("\n[smoke] ===== summary =====");
  console.log(`[smoke] run ${RUN_ID}, mode ${summary.mode ?? "n/a"}, total ${Date.now() - started}ms`);
  if (summary.contractCampaignId !== undefined) {
    console.log(`[smoke] contractCampaignId ${summary.contractCampaignId}, backendId ${summary.backendId}, slug ${summary.slug}`);
  }
  for (const { step, ms } of timings) console.log(`[smoke]   ${step.padEnd(20)} ${ms}ms`);
  if (Object.keys(txHashes).length) {
    console.log("[smoke] tx hashes:");
    for (const [k, v] of Object.entries(txHashes)) console.log(`[smoke]   ${k.padEnd(20)} ${v}`);
  }
  if (summary.expectedFeeUnits !== undefined) {
    console.log(`[smoke] fee split: fee ${summary.expectedFeeUnits}, net ${summary.expectedNetUnits} -> ${summary.BENEFICIARY}`);
  }
  if (summary.note) {
    console.log(`[smoke] note: ${summary.note}`);
  }
  if (summary.skipped?.length) {
    console.log(`[smoke] skipped steps: ${summary.skipped.join(", ")}`);
  }
  console.log("[smoke] ===================");
}

main().catch((err) => {
  const step = err instanceof SmokeError ? err.step : "unknown";
  const reason = err?.message ?? String(err);
  console.error(`SMOKE_FAIL ${step}: ${reason}`);
  if (!(err instanceof SmokeError)) console.error(err.stack);
  process.exit(1);
});
