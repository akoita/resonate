// Shared helpers for the staging Shows harnesses (#1392 lifecycle smoke, #1271
// reconciliation drift drill). Both scripts import from here so the config,
// RPC-lag retry, escrow/ERC-20 ABIs, auth flow, and step logging stay in ONE
// place and cannot drift apart. Dependency: viem only. Node 20+.

import { parseAbi, decodeEventLog, getAddress } from "viem";

// ---------------------------------------------------------------------------
// Run identity + constants
// ---------------------------------------------------------------------------

export const RUN_ID = process.env.GITHUB_RUN_ID
  ? `${process.env.GITHUB_RUN_ID}-${process.env.GITHUB_RUN_ATTEMPT ?? "1"}`
  : `${Date.now()}`;

export const FAUCET_URL = "https://faucet.circle.com";

// ---------------------------------------------------------------------------
// Config helpers
// ---------------------------------------------------------------------------

export class SmokeError extends Error {
  constructor(step, reason) {
    super(reason);
    this.step = step;
  }
}

export function req(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new SmokeError("preflight", `missing required env ${name}`);
  return value;
}

export function num(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return BigInt(raw);
}

export function int(name, fallback) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  return Number.parseInt(raw, 10);
}

export function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// RPC helpers (the public endpoint is load-balanced; reads/simulations on one
// replica may not yet see a block another replica just produced).
// ---------------------------------------------------------------------------

// Retry writes whose SIMULATION reverts, briefly — real contract reverts keep
// failing and surface after the last attempt. `run` supplies the step logger.
export async function writeWithLagRetry(wallet, params, step, run, attempts = 5, delayMs = 3000) {
  let lastError;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await wallet.writeContract(params);
    } catch (error) {
      lastError = error;
      const message = String(error?.message ?? error);
      const simulationRevert =
        message.includes("reverted") || message.includes("execution reverted");
      if (!simulationRevert || i === attempts - 1) throw error;
      run.info(
        step,
        `simulation reverted (possible replica lag), retry ${i + 1}/${attempts - 1} in ${delayMs}ms`,
      );
      await sleep(delayMs);
    }
  }
  throw lastError;
}

// Poll a fresh campaignStatus read until it reaches one of `wanted`, or throw
// after the bound. Used for post-write assertions so read lag can't fail a step
// whose write succeeded.
export async function readStatusUntil(
  publicClient,
  escrow,
  abi,
  campaignId,
  wanted,
  statusNames,
  step,
  timeoutMs = 60000,
  delayMs = 3000,
) {
  const wantSet = new Set(wanted);
  const deadline = Date.now() + timeoutMs;
  let last;
  for (;;) {
    const code = Number(
      await publicClient.readContract({
        address: escrow,
        abi,
        functionName: "campaignStatus",
        args: [campaignId],
      }),
    );
    last = statusNames[code] ?? code;
    if (wantSet.has(last)) return last;
    if (Date.now() >= deadline) {
      throw new SmokeError(
        step,
        `on-chain status is ${last} after ${Math.round(timeoutMs / 1000)}s, expected one of ${wanted.join("/")}`,
      );
    }
    await sleep(delayMs);
  }
}

// ---------------------------------------------------------------------------
// HTTP / auth helpers
// ---------------------------------------------------------------------------

export async function fetchJson(url, init, step) {
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

export function authHeaders(token) {
  return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
}

export function decodeJwtRole(token) {
  const parts = token.split(".");
  if (parts.length !== 3) throw new SmokeError("auth", "JWT is not a well-formed token");
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  return payload.role;
}

// Authenticate an EOA as an operator via /auth/nonce + /auth/verify and return
// the JWT. Mirrors the web client's SIWE-style message so the backend's
// /Nonce:\s*(.+)$/m extraction matches.
export async function authenticateOperator(apiBase, wallet, account, expectedChainId, step = "auth") {
  const address = account.address;
  const { nonce } = await fetchJson(
    `${apiBase}/auth/nonce`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address }),
    },
    step,
  );
  if (!nonce) throw new SmokeError(step, "nonce endpoint returned no nonce");
  const message = `Resonate Sign-In\nAddress: ${address}\nNonce: ${nonce}\nIssued At: ${new Date().toISOString()}`;
  const signature = await wallet.signMessage({ account, message });
  const verify = await fetchJson(
    `${apiBase}/auth/verify`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, message, signature, role: "operator", chainId: expectedChainId }),
    },
    step,
  );
  const token = verify.accessToken;
  if (!token) throw new SmokeError(step, `verify returned no accessToken: ${JSON.stringify(verify)}`);
  const role = decodeJwtRole(token);
  if (role !== "operator") {
    throw new SmokeError(step, `JWT role is "${role}", expected "operator" — is ${address} in OPERATOR_ADDRESSES?`);
  }
  return token;
}

// ---------------------------------------------------------------------------
// Escrow + ERC-20 ABIs (fragments from
// contracts/src/core/ShowCampaignEscrow.sol + IShowCampaignEscrow.sol).
// ---------------------------------------------------------------------------

export const ESCROW_ABI = parseAbi([
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

export const ERC20_ABI = parseAbi([
  "function balanceOf(address owner) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function allowance(address owner, address spender) view returns (uint256)",
]);

// Escrow CampaignStatus enum order (IShowCampaignEscrow.sol).
export const STATUS_NAMES = [
  "Draft", "Active", "Funded", "BookingConfirmed", "DepositReleased",
  "Fulfilled", "Released", "Cancelled", "RefundAvailable", "Refunded",
];

// ---------------------------------------------------------------------------
// Misc helpers + assertions
// ---------------------------------------------------------------------------

export function normalizeKey(key) {
  return key.startsWith("0x") ? key : `0x${key}`;
}

export function extractCampaignId(logs) {
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

export function assertAddressEqual(step, field, actual, expected) {
  if (!actual) throw new SmokeError(step, `${field} is missing on the API response`);
  if (getAddress(actual) !== getAddress(expected)) {
    throw new SmokeError(step, `${field} is ${actual}, expected ${expected}`);
  }
}

export function assertUnits(step, field, actual, expected) {
  if (actual === undefined || actual === null) throw new SmokeError(step, `${field} is missing`);
  if (BigInt(actual) !== expected) {
    throw new SmokeError(step, `${field} is ${actual}, expected ${expected}`);
  }
}

// ---------------------------------------------------------------------------
// Run logger — per-script step timings, tx-hash ledger, and summary. `prefix`
// tags every line (e.g. "smoke" or "drill").
// ---------------------------------------------------------------------------

export function createRun(prefix = "smoke") {
  const started = Date.now();
  const timings = [];
  const txHashes = {};
  const tag = `[${prefix}]`;

  const ok = (step, since, extra) => {
    const ms = Date.now() - since;
    timings.push({ step, ms });
    console.log(`${tag} ${step} OK (${ms}ms)${extra ? ` — ${extra}` : ""}`);
  };
  const info = (step, message) => console.log(`${tag} ${step} … ${message}`);
  const warn = (message) => console.warn(`${tag} ${message}`);

  const report = (summary) => {
    console.log(`\n${tag} ===== summary =====`);
    console.log(`${tag} run ${RUN_ID}, mode ${summary.mode ?? "n/a"}, total ${Date.now() - started}ms`);
    if (summary.contractCampaignId !== undefined) {
      console.log(`${tag} contractCampaignId ${summary.contractCampaignId}, backendId ${summary.backendId}, slug ${summary.slug}`);
    }
    for (const { step, ms } of timings) console.log(`${tag}   ${step.padEnd(22)} ${ms}ms`);
    if (Object.keys(txHashes).length) {
      console.log(`${tag} tx hashes:`);
      for (const [k, v] of Object.entries(txHashes)) console.log(`${tag}   ${k.padEnd(22)} ${v}`);
    }
    if (summary.expectedFeeUnits !== undefined) {
      console.log(`${tag} fee split: fee ${summary.expectedFeeUnits}, net ${summary.expectedNetUnits} -> ${summary.BENEFICIARY}`);
    }
    if (summary.note) console.log(`${tag} note: ${summary.note}`);
    if (summary.skipped?.length) console.log(`${tag} skipped steps: ${summary.skipped.join(", ")}`);
    console.log(`${tag} ===================`);
  };

  return { started, timings, txHashes, ok, info, warn, report, prefix, tag };
}

// Shared top-level failure handler: prints the canonical `SMOKE_FAIL <step>:
// <reason>` line the workflows grep for, then exits non-zero.
export function failAndExit(err) {
  const step = err instanceof SmokeError ? err.step : "unknown";
  const reason = err?.message ?? String(err);
  console.error(`SMOKE_FAIL ${step}: ${reason}`);
  if (!(err instanceof SmokeError)) console.error(err.stack);
  process.exit(1);
}
