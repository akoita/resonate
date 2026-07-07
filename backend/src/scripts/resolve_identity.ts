import "dotenv/config";
import { createHash } from "crypto";
import { prisma } from "../db/prisma";

/**
 * #1407 — Identity-continuity diagnostic (read-only).
 *
 * Resolves a user's canonical identity from the database so a migration can be
 * PROVEN to preserve accounts: run this against the source DB and again against
 * the target DB for the same passkey/wallet — identical output means the
 * returning user's passkey lands on the same account.
 *
 * Because a user is a device passkey → a CREATE2-deterministic smart account,
 * the only thing a project migration must carry is the Postgres mapping rows
 * (PasskeyIdentity → User → Wallet). This script reads exactly that mapping.
 * It writes nothing.
 *
 * Usage (one selector required):
 *   ts-node src/scripts/resolve_identity.ts --public-key-hash <sha256hex>
 *   ts-node src/scripts/resolve_identity.ts --pubkey-x <hex64> --pubkey-y <hex64>
 *   ts-node src/scripts/resolve_identity.ts --wallet <0xaddress>
 *
 * Output: a single JSON line { publicKeyHash, userId, walletAddress, chainId,
 * accountType, firstWalletAddress, lastWalletAddress, found } — stable across
 * DB copies, so `diff` of source vs target output is the continuity assertion.
 */

const HEX_COORD = /^[0-9a-f]{64}$/;

export interface IdentitySelector {
  publicKeyHash?: string | null;
  pubKeyX?: string | null;
  pubKeyY?: string | null;
  wallet?: string | null;
}

export interface ResolvedIdentity {
  publicKeyHash: string | null;
  userId: string | null;
  walletAddress: string | null;
  chainId: number | null;
  accountType: string | null;
  firstWalletAddress: string | null;
  lastWalletAddress: string | null;
  found: boolean;
}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : undefined;
}

export function passkeyPublicKeyHash(pubKeyX?: string | null, pubKeyY?: string | null): string | null {
  const x = pubKeyX?.trim().toLowerCase();
  const y = pubKeyY?.trim().toLowerCase();
  if (!x || !y || !HEX_COORD.test(x) || !HEX_COORD.test(y)) return null;
  return createHash("sha256").update(`${x}:${y}`).digest("hex");
}

/**
 * The core resolution — read-only, importable by the migration verification
 * gate (resonate#1408). Returns the canonical identity mapping; deterministic
 * across DB copies, so source/target results compare directly.
 */
export async function resolveIdentity(selector: IdentitySelector): Promise<ResolvedIdentity> {
  const walletArg = selector.wallet?.trim().toLowerCase();
  const publicKeyHash =
    selector.publicKeyHash?.trim().toLowerCase() ??
    passkeyPublicKeyHash(selector.pubKeyX, selector.pubKeyY) ??
    undefined;

  let userId: string | null = null;
  let passkey: {
    publicKeyHash: string;
    userId: string;
    firstWalletAddress: string | null;
    lastWalletAddress: string | null;
  } | null = null;

  // Passkey hash is the master lookup; a wallet address is the fallback
  // selector (its userId is the identity).
  if (publicKeyHash) {
    passkey = await prisma.passkeyIdentity.findUnique({
      where: { publicKeyHash },
      select: { publicKeyHash: true, userId: true, firstWalletAddress: true, lastWalletAddress: true },
    });
    userId = passkey?.userId ?? null;
  } else if (walletArg) {
    const walletByAddress = await prisma.wallet.findFirst({
      where: { address: walletArg },
      select: { userId: true },
    });
    userId = walletByAddress?.userId ?? null;
  }

  const wallet = userId
    ? await prisma.wallet.findUnique({
        where: { userId },
        select: { address: true, chainId: true, accountType: true },
      })
    : null;

  return {
    publicKeyHash: passkey?.publicKeyHash ?? publicKeyHash ?? null,
    userId,
    walletAddress: wallet?.address ?? null,
    chainId: wallet?.chainId ?? null,
    accountType: wallet?.accountType ?? null,
    firstWalletAddress: passkey?.firstWalletAddress ?? null,
    lastWalletAddress: passkey?.lastWalletAddress ?? null,
    found: Boolean(userId),
  };
}

async function main() {
  const selector: IdentitySelector = {
    publicKeyHash: arg("public-key-hash"),
    pubKeyX: arg("pubkey-x"),
    pubKeyY: arg("pubkey-y"),
    wallet: arg("wallet"),
  };

  if (!selector.publicKeyHash && !(selector.pubKeyX && selector.pubKeyY) && !selector.wallet) {
    console.error(
      "resolve_identity: provide one of --public-key-hash, (--pubkey-x + --pubkey-y), or --wallet",
    );
    process.exit(2);
  }

  const result = await resolveIdentity(selector);

  // Single JSON line so source/target runs can be diffed directly.
  console.log(JSON.stringify(result));
  await prisma.$disconnect();
  // Exit 1 when the selector resolved nothing, so a verification gate can treat
  // "known user not found on target" as a failure.
  process.exit(result.found ? 0 : 1);
}

// Run the CLI only when executed directly, not when imported (e.g. by the
// migration verification gate or tests).
if (require.main === module) {
  main().catch(async (err) => {
    console.error("resolve_identity failed:", err instanceof Error ? err.message : err);
    await prisma.$disconnect().catch(() => undefined);
    process.exit(2);
  });
}
