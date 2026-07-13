#!/usr/bin/env node
// Staging reconciliation drift drill (#1271).
//
// Proves the Shows reconciliation-mismatch alert is REAL end to end: it provokes
// a genuine on-chain-pledge-without-backend-intent drift against the REAL
// staging deployment and asserts the escrow indexer detects it and surfaces it
// on the operator endpoint. This is the last implementation gap in the #1271
// production go-live gate — the money path itself is covered by the lifecycle
// smoke (#1392); this covers the SAFETY NET that catches a broken/lagging
// indexer or an out-of-band on-chain pledge.
//
// The drift is deliberate: we bind a campaign in the backend (draft + authority
// + activate/link), then pledge on-chain from the smoke wallet WITHOUT creating
// the backend pledge intent. The indexer sees a Pledged event on a bound
// campaign with no matching intent -> emitMismatch() -> structured
// `shows.campaign_reconciliation_mismatch` app-event line (the iac log-based
// metric + Cloud Monitoring email alert) AND a durable analytics fact the
// operator endpoint reads back. PASS = that fact appears with our pledge txHash
// and a "no matching backend intent" reason within the bound.
//
// Cleanup mirrors the smoke's auto refund loop: cancelCampaign (deployer) ->
// claimRefund (smoke wallet) -> USDC fully restored (delta 0) -> backend settles
// to a discovery-excluded state. No lingering campaign, no stranded USDC.
//
// workflow_dispatch ONLY (see .github/workflows/staging-reconciliation-drill.yml)
// — each run burns a campaign and relies on indexer timing; operators run it
// after deploys that touch the indexer and for the #1271 gate proof.
//
// Dependency: viem only. Node 20+ (global fetch, top-level await).
//
// Env contract (shared with the lifecycle smoke — see
// docs/features/staging_reconciliation_drill.md):
//   API_BASE                        required  e.g. https://api-staging.resonate.pydes.xyz
//   RPC_URL                         required  Base Sepolia JSON-RPC
//   SHOW_CAMPAIGN_ESCROW_ADDRESS    required  deployed escrow
//   PAYMENT_TOKEN                   required  USDC (6 decimals)
//   CONTRACT_DEPLOYER_PRIVATE_KEY   required  escrow owner (create/activate/cancel)
//   SMOKE_WALLET_PRIVATE_KEY        required  pre-funded EOA that pledges + authenticates
//   SMOKE_BENEFICIARY               optional  default platform test smart account
//   SMOKE_ARTIST_DISPLAY_NAME       optional  catalog artist the draft credits (default "Smoke Test Artist")
//   SMOKE_ARTIST_ID                 optional  explicit catalog artistId
//   EXPECTED_CHAIN_ID               optional  default 84532
//   PLEDGE_UNITS                    optional  default 1000000 (1 USDC)
//   GOAL_UNITS                      optional  default 1000000
//   EXPECTED_FEE_BPS                optional  default 600 (6%)
//   DISPUTE_WINDOW_SECONDS          optional  default 3600 (contract MIN_DISPUTE_WINDOW)
//   MIN_USDC_UNITS                  optional  default 2000000 (2 USDC)
//   MIN_GAS_WEI                     optional  default 2000000000000000 (0.002 ETH)
//   MISMATCH_TIMEOUT_MS             optional  default 240000 (4 min) bound on detection polling
//   REFUND_TIMEOUT_MS               optional  default 180000 (3 min) bound on refund-state polling
//   MISMATCH_LOOKBACK_MINUTES       optional  default 60 window queried on the operator endpoint
//
// Flags: --dry-run stops cleanly after preflight + auth (no campaign burned).

import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  toHex,
  getAddress,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";
import {
  RUN_ID,
  FAUCET_URL,
  SmokeError,
  req,
  num,
  int,
  sleep,
  writeWithLagRetry,
  readStatusUntil,
  fetchJson,
  authHeaders,
  authenticateOperator,
  assertAddressEqual,
  ESCROW_ABI,
  ERC20_ABI,
  STATUS_NAMES,
  normalizeKey,
  extractCampaignId,
  createRun,
  failAndExit,
} from "./lib.mjs";

const DRIFT_REASON_NEEDLE = "no matching backend intent";

const DRY_RUN = process.argv.includes("--dry-run");
const run = createRun("drill");
const { ok, info, warn, txHashes } = run;

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
  const MISMATCH_TIMEOUT_MS = int("MISMATCH_TIMEOUT_MS", 240_000);
  const REFUND_TIMEOUT_MS = int("REFUND_TIMEOUT_MS", 180_000);
  const MISMATCH_LOOKBACK_MINUTES = int("MISMATCH_LOOKBACK_MINUTES", 60);
  const ARTIST_DISPLAY_NAME = process.env.SMOKE_ARTIST_DISPLAY_NAME?.trim() || "Smoke Test Artist";
  const ARTIST_ID = process.env.SMOKE_ARTIST_ID?.trim() || null;

  const deployerAccount = privateKeyToAccount(normalizeKey(req("CONTRACT_DEPLOYER_PRIVATE_KEY")));
  const smokeAccount = privateKeyToAccount(normalizeKey(req("SMOKE_WALLET_PRIVATE_KEY")));

  const transport = http(RPC_URL);
  const publicClient = createPublicClient({ chain: baseSepolia, transport });
  const deployerWallet = createWalletClient({ account: deployerAccount, chain: baseSepolia, transport });
  const smokeWallet = createWalletClient({ account: smokeAccount, chain: baseSepolia, transport });

  // === 1. preflight =========================================================
  let smokeUsdcAtStart; // baseline for the cleanup refund-restoration assertion
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
    token = await authenticateOperator(API_BASE, smokeWallet, smokeAccount, EXPECTED_CHAIN_ID, "auth");
    ok("auth", t, `operator token for ${smokeAccount.address}`);
  }

  if (DRY_RUN) {
    console.log("[drill] --dry-run: stopped cleanly after preflight + auth");
    run.report({ mode: "drift", skipped: ["chain-create", "api-bind", "drift-pledge", "assert-detection", "cleanup"] });
    return;
  }

  // === 3. chain-create + activate (deployer key) ============================
  const nowSec = BigInt(Math.floor(Date.now() / 1000));
  const deadline = nowSec + 30n * 60n;
  const bookingDeadline = nowSec + 60n * 60n;
  const artistIdHash = keccak256(toHex(`drill:${RUN_ID}:artist`));
  const authorityHash = keccak256(toHex(`drill:${RUN_ID}:authority`));
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

    const activateHash = await writeWithLagRetry(deployerWallet, {
      address: ESCROW, abi: ESCROW_ABI, functionName: "activateCampaign", args: [contractCampaignId],
    }, "chain-create", run);
    txHashes.activateCampaignChain = activateHash;
    const activateReceipt = await publicClient.waitForTransactionReceipt({ hash: activateHash });
    if (activateReceipt.status !== "success") throw new SmokeError("chain-create", `activateCampaign tx reverted (${activateHash})`);
    ok("chain-create", t, `campaignId ${contractCampaignId}`);
  }

  // === 4. api-bind (draft + authority + activate/link) ======================
  // The campaign MUST be bound in the backend so the indexer maps the on-chain
  // campaign to a backend row — otherwise the drift would be the "no backend
  // campaign bound" variety, not the pledge-without-intent one this drill
  // targets. Mirrors lifecycle-smoke steps 4-5 (incl. the resync hydration
  // wait), minus the pledge intent.
  let backendId;
  let slug;
  {
    const t = Date.now();
    const draftBody = {
      artistDisplayName: ARTIST_DISPLAY_NAME,
      ...(ARTIST_ID ? { artistId: ARTIST_ID } : {}),
      title: `Drift drill ${RUN_ID} — reconciliation test`,
      description: "Automated staging reconciliation drift drill (#1271). Not a real show — safe to ignore.",
      city: "Drill",
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
    }, "api-bind");
    backendId = draft.id;
    slug = draft.slug;
    if (!backendId || !slug) throw new SmokeError("api-bind", `draft missing id/slug: ${JSON.stringify(draft).slice(0, 200)}`);

    await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(backendId)}/authority`, {
      method: "PATCH",
      headers: authHeaders(token),
      body: JSON.stringify({
        authorityStatus: "artist_authorized",
        beneficiaryAddress: BENEFICIARY,
        beneficiaryType: "wallet",
        authorityCredentialId: `drill-${RUN_ID}`,
      }),
    }, "api-bind");

    let activated = await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(backendId)}/activate`, {
      method: "POST",
      headers: authHeaders(token),
      body: JSON.stringify({ contractAddress: ESCROW, contractCampaignId: contractCampaignId.toString() }),
    }, "api-bind");

    // The backend hydrates from its own RPC replica, which can lag the one that
    // just confirmed our activate tx (#1399). Do what an operator would: poll
    // resync-chain with backoff before failing.
    const hydrationStale = (c) => c.onChainStatus !== "Active" || c.feeBps !== EXPECTED_FEE_BPS;
    for (let attempt = 1; hydrationStale(activated) && attempt <= 5; attempt++) {
      info("api-bind", `hydration stale (onChainStatus "${activated.onChainStatus}", feeBps ${activated.feeBps}) — resync ${attempt}/5 in 4000ms`);
      await sleep(4000);
      activated = await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(backendId)}/resync-chain`, {
        method: "POST",
        headers: authHeaders(token),
      }, "api-bind");
    }

    assertAddressEqual("api-bind", "paymentTokenAddress", activated.paymentTokenAddress, PAYMENT_TOKEN);
    if (activated.onChainStatus !== "Active") {
      throw new SmokeError("api-bind", `onChainStatus is "${activated.onChainStatus}", expected "Active" (after 5 resync attempts — not replica lag)`);
    }
    ok("api-bind", t, `bound campaign ${contractCampaignId} -> backend ${backendId}, onChainStatus Active`);
  }

  // === 5. drift-pledge (on-chain pledge WITHOUT a backend intent) ===========
  // This is the deliberate drift: no /pledges/intent call, so the indexer finds
  // a Pledged event on a bound campaign with no matching intent.
  let pledgeTxHash;
  {
    const t = Date.now();
    const allowance = await publicClient.readContract({
      address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "allowance", args: [smokeAccount.address, ESCROW],
    });
    if (allowance < PLEDGE_UNITS) {
      const approveHash = await smokeWallet.writeContract({
        address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "approve", args: [ESCROW, PLEDGE_UNITS],
      });
      txHashes.approve = approveHash;
      const approveReceipt = await publicClient.waitForTransactionReceipt({ hash: approveHash });
      if (approveReceipt.status !== "success") throw new SmokeError("drift-pledge", `approve tx reverted (${approveHash})`);
    }
    pledgeTxHash = await writeWithLagRetry(smokeWallet, {
      address: ESCROW, abi: ESCROW_ABI, functionName: "pledge", args: [contractCampaignId, PLEDGE_UNITS],
    }, "drift-pledge", run);
    txHashes.driftPledge = pledgeTxHash;
    const pledgeReceipt = await publicClient.waitForTransactionReceipt({ hash: pledgeTxHash });
    if (pledgeReceipt.status !== "success") throw new SmokeError("drift-pledge", `pledge tx reverted (${pledgeTxHash})`);
    ok("drift-pledge", t, `on-chain pledge WITHOUT backend intent, tx ${pledgeTxHash}`);
  }

  // === 6. assert-detection (the PASS condition) =============================
  // Poll the operator endpoint until the indexer's mismatch fact appears with
  // OUR pledge txHash and a "no matching backend intent" reason.
  {
    const t = Date.now();
    const wantTx = pledgeTxHash.toLowerCase();
    const url =
      `${API_BASE}/shows/operator/reconciliation-mismatches` +
      `?contractCampaignId=${encodeURIComponent(contractCampaignId.toString())}` +
      `&sinceMinutes=${MISMATCH_LOOKBACK_MINUTES}&limit=50`;
    const deadlineMs = Date.now() + MISMATCH_TIMEOUT_MS;
    let seen = 0;
    for (;;) {
      const rows = await fetchJson(url, { headers: authHeaders(token) }, "assert-detection");
      const list = Array.isArray(rows) ? rows : [];
      seen = list.length;
      const match = list.find(
        (r) =>
          typeof r?.transactionHash === "string" &&
          r.transactionHash.toLowerCase() === wantTx &&
          typeof r?.reason === "string" &&
          r.reason.includes(DRIFT_REASON_NEEDLE),
      );
      if (match) {
        ok(
          "assert-detection",
          t,
          `mismatch detected: escrowEvent ${match.escrowEventName}, reason "${match.reason}"`,
        );
        break;
      }
      if (Date.now() + 6000 >= deadlineMs) {
        throw new SmokeError(
          "assert-detection",
          `no reconciliation mismatch for pledge ${pledgeTxHash} on campaign ${contractCampaignId} within ${MISMATCH_TIMEOUT_MS}ms ` +
            `(${seen} row(s) returned in the ${MISMATCH_LOOKBACK_MINUTES}min window) — the indexer alert did not fire`,
        );
      }
      await sleep(6000);
    }
  }

  // === 7. cleanup (cancel + refund, restore USDC, settle backend) ===========
  // Mirror the smoke's auto refund loop so the drill self-cleans: the campaign
  // is Funded (1 backer, goal met by our pledge), which is cancellable.
  {
    const t = Date.now();
    const cancelHash = await writeWithLagRetry(deployerWallet, {
      address: ESCROW, abi: ESCROW_ABI, functionName: "cancelCampaign", args: [contractCampaignId],
    }, "cleanup-cancel", run);
    txHashes.cancelCampaign = cancelHash;
    const receipt = await publicClient.waitForTransactionReceipt({ hash: cancelHash });
    if (receipt.status !== "success") throw new SmokeError("cleanup-cancel", `cancelCampaign tx reverted (${cancelHash})`);
    await readStatusUntil(
      publicClient, ESCROW, ESCROW_ABI, contractCampaignId,
      ["RefundAvailable"], STATUS_NAMES, "cleanup-cancel",
    );
    ok("cleanup-cancel", t, `campaign ${contractCampaignId} -> RefundAvailable`);
  }

  {
    const t = Date.now();
    const claimHash = await writeWithLagRetry(smokeWallet, {
      address: ESCROW, abi: ESCROW_ABI, functionName: "claimRefund", args: [contractCampaignId],
    }, "cleanup-refund", run);
    txHashes.claimRefund = claimHash;
    const receipt = await publicClient.waitForTransactionReceipt({ hash: claimHash });
    if (receipt.status !== "success") throw new SmokeError("cleanup-refund", `claimRefund tx reverted (${claimHash})`);

    // Poll through replica lag until the refund accounting settles: refunds are
    // fee-free, so the smoke wallet's USDC returns to its pre-run balance.
    const refundDeadline = Date.now() + 60000;
    let campaignTuple, usdcNow;
    for (;;) {
      [campaignTuple, usdcNow] = await Promise.all([
        publicClient.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: "campaigns", args: [contractCampaignId] }),
        publicClient.readContract({ address: PAYMENT_TOKEN, abi: ERC20_ABI, functionName: "balanceOf", args: [smokeAccount.address] }),
      ]);
      if (campaignTuple[11] === PLEDGE_UNITS && usdcNow === smokeUsdcAtStart) break;
      if (Date.now() >= refundDeadline) {
        if (campaignTuple[11] !== PLEDGE_UNITS) {
          throw new SmokeError("cleanup-refund", `on-chain totalRefunded ${campaignTuple[11]} != pledged ${PLEDGE_UNITS} after 60s`);
        }
        throw new SmokeError("cleanup-refund", `smoke wallet USDC ${usdcNow} != pre-run balance ${smokeUsdcAtStart} after 60s — refund did not restore the pledge`);
      }
      await sleep(3000);
    }
    const statusCode = Number(campaignTuple[15]);
    ok("cleanup-refund", t, `totalRefunded ${campaignTuple[11]}, wallet restored, on-chain status ${STATUS_NAMES[statusCode] ?? statusCode}`);
  }

  {
    const t = Date.now();
    const REFUND_STATES = ["refund_available", "cancelled", "refunded"];
    const deadlineMs = Date.now() + REFUND_TIMEOUT_MS;
    let last = null;
    for (;;) {
      const campaign = await fetchJson(`${API_BASE}/shows/campaigns/${encodeURIComponent(slug)}`, undefined, "cleanup-backend-state");
      last = campaign;
      if (REFUND_STATES.includes(campaign.status)) {
        ok("cleanup-backend-state", t, `status ${campaign.status} (discovery-excluded), onChainStatus ${campaign.onChainStatus}`);
        break;
      }
      if (Date.now() + 6000 >= deadlineMs) {
        throw new SmokeError(
          "cleanup-backend-state",
          `campaign not in a refund state within ${REFUND_TIMEOUT_MS}ms (status ${last?.status}/${last?.onChainStatus}) — refund indexer leg broken`,
        );
      }
      await sleep(6000);
    }
  }

  // === 8. alert reminder ====================================================
  // The workflow cannot assert email delivery; surface the expected alert so an
  // operator running the drill can confirm the Cloud Monitoring notification.
  warn(
    "REMINDER: the Cloud Monitoring email alert on " +
      'backend_app_events{event="shows.campaign_reconciliation_mismatch"} should have fired for this drift. ' +
      "Confirm the notification arrived (see docs/smart-contracts/operations-runbook.md).",
  );

  run.report({
    mode: "drift",
    note: `reconciliation drift detected + cleaned up — USDC recycled, campaign discovery-excluded. Alert metric: shows.campaign_reconciliation_mismatch (pledge ${pledgeTxHash}).`,
    contractCampaignId,
    backendId,
    slug,
  });
}

main().catch(failAndExit);
