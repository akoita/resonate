/**
 * #1407 — identity-continuity diagnostic (Testcontainers Postgres).
 *
 * Proves the property a GCP-project migration relies on: given the mapping rows
 * (PasskeyIdentity → User → Wallet), a passkey resolves to the same
 * userId/wallet regardless of which database copy it runs against. The verify
 * gate (resonate#1408) uses this to assert continuity source-vs-target.
 */

import { createHash } from "crypto";
import { prisma } from "../db/prisma";
import { resolveIdentity, passkeyPublicKeyHash } from "../scripts/resolve_identity";

const TEST_PREFIX = `residentity_${Date.now()}_`;
const userId = `${TEST_PREFIX}user`;
const wallet = "0x" + "a".repeat(40);
const pubKeyX = "a".repeat(64);
const pubKeyY = "b".repeat(64);
const publicKeyHash = createHash("sha256").update(`${pubKeyX}:${pubKeyY}`).digest("hex");

describe("resolveIdentity (integration)", () => {
  beforeAll(async () => {
    await prisma.user.create({
      data: { id: userId, email: `${TEST_PREFIX}@wallet.resonate` },
    });
    await prisma.wallet.create({
      data: { userId, address: wallet, chainId: 84532, accountType: "erc4337" },
    });
    await prisma.passkeyIdentity.create({
      data: {
        publicKeyHash,
        userId,
        firstWalletAddress: wallet,
        lastWalletAddress: wallet,
      },
    });
  });

  afterAll(async () => {
    await prisma.passkeyIdentity.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("hashes passkey coordinates the same way auth.service does", () => {
    expect(passkeyPublicKeyHash(pubKeyX, pubKeyY)).toBe(publicKeyHash);
    expect(passkeyPublicKeyHash(pubKeyX.toUpperCase(), pubKeyY.toUpperCase())).toBe(publicKeyHash);
    expect(passkeyPublicKeyHash("nothex", pubKeyY)).toBeNull();
  });

  it("resolves the same identity from passkey hash, coordinates, or wallet", async () => {
    const expected = {
      publicKeyHash,
      userId,
      walletAddress: wallet,
      chainId: 84532,
      accountType: "erc4337",
      firstWalletAddress: wallet,
      lastWalletAddress: wallet,
      found: true,
    };

    expect(await resolveIdentity({ publicKeyHash })).toEqual(expected);
    expect(await resolveIdentity({ pubKeyX, pubKeyY })).toEqual(expected);
    // Wallet-selector path resolves the same userId/wallet (passkey fields are
    // null since it did not go through the passkey lookup).
    const byWallet = await resolveIdentity({ wallet });
    expect(byWallet.userId).toBe(userId);
    expect(byWallet.walletAddress).toBe(wallet);
    expect(byWallet.chainId).toBe(84532);
    expect(byWallet.found).toBe(true);
  });

  it("returns found=false for an unknown passkey (verify gate treats as failure)", async () => {
    const result = await resolveIdentity({ publicKeyHash: "f".repeat(64) });
    expect(result.found).toBe(false);
    expect(result.userId).toBeNull();
    expect(result.walletAddress).toBeNull();
  });

  it("is stable across a simulated migration (delete+recreate the same rows)", async () => {
    const before = await resolveIdentity({ publicKeyHash });

    // Simulate a dump→restore: the same logical rows re-created (e.g. on the
    // target DB). Identity resolution must be byte-identical.
    await prisma.passkeyIdentity.deleteMany({ where: { userId } });
    await prisma.wallet.deleteMany({ where: { userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.user.create({ data: { id: userId, email: `${TEST_PREFIX}@wallet.resonate` } });
    await prisma.wallet.create({
      data: { userId, address: wallet, chainId: 84532, accountType: "erc4337" },
    });
    await prisma.passkeyIdentity.create({
      data: { publicKeyHash, userId, firstWalletAddress: wallet, lastWalletAddress: wallet },
    });

    const after = await resolveIdentity({ publicKeyHash });
    expect(after).toEqual(before);
  });
});
