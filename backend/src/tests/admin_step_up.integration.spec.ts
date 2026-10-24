/**
 * The admin step-up (#2173) against a real Postgres and the Testcontainer Anvil.
 *
 * Nothing that decides anything is mocked: real `AdminStepUpService`, real
 * `AuthService` against the real `Wallet` table, real signatures from real
 * keys, a real viem client, and the real `AdminAuditEvent` table. Only the JWT
 * signer and the platform audit logger (unused by these paths) are stubs.
 */
import { BadRequestException, ForbiddenException } from "@nestjs/common";
import { createPublicClient, http, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { prisma } from "../db/prisma";
import { AdminStepUpService } from "../modules/admin_step_up/admin_step_up.service";
import { AdminStepUpTokenService } from "../modules/admin_step_up/admin_step_up_token.service";
import { buildAdminStepUpMessage } from "../modules/admin_step_up/admin_step_up_message";
import { AuthService } from "../modules/auth/auth.service";
import { buildAccountClosureMessage } from "../modules/privacy/account_closure_message";

const TEST_PREFIX = `step_up_${Date.now()}_`;
const ADMIN = `${TEST_PREFIX}admin`;
const OTHER_ADMIN = `${TEST_PREFIX}other_admin`;
const NO_WALLET = `${TEST_PREFIX}no_wallet`;
const USER_IDS = [ADMIN, OTHER_ADMIN, NO_WALLET];

const adminKey = privateKeyToAccount(generatePrivateKey());
const otherKey = privateKeyToAccount(generatePrivateKey());
const strangerKey = privateKeyToAccount(generatePrivateKey());
const ADMIN_ADDRESS = adminKey.address.toLowerCase();

const tokens = new AdminStepUpTokenService({ get: (key: string) => (key === "JWT_SECRET" ? "step-up-int" : undefined) } as any);
const authService = new AuthService({ sign: jest.fn() } as any, { log: jest.fn() } as any);
let service: AdminStepUpService;

const eventsFor = (actor: string) =>
  prisma.adminAuditEvent.findMany({ where: { actorUserId: actor }, orderBy: { createdAt: "asc" } });

async function answer(userId: string, key = adminKey, message?: (m: string) => string) {
  const challenge = await service.challenge(userId);
  const signature = await key.signMessage({ message: message ? message(challenge.message) : challenge.message });
  return { challenge, signature, input: { address: challenge.address, signature, challengeToken: challenge.challengeToken } };
}

beforeAll(async () => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) throw new Error("ANVIL_RPC_URL is not set; the Testcontainer Anvil did not start");
  const publicClient = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;
  service = new AdminStepUpService(tokens, authService, publicClient);

  for (const id of USER_IDS) {
    await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  }
  await prisma.wallet.create({ data: { userId: ADMIN, address: ADMIN_ADDRESS, chainId: 31337 } });
  await prisma.wallet.create({ data: { userId: OTHER_ADMIN, address: otherKey.address.toLowerCase(), chainId: 31337 } });
});

afterAll(async () => {
  await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: { in: USER_IDS } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: USER_IDS } } });
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
  await prisma.$disconnect();
});

afterEach(async () => {
  await prisma.adminAuditEvent.deleteMany({ where: { actorUserId: { in: USER_IDS } } });
});

describe("Admin step-up (integration)", () => {
  it("issues a short-lived proof for the signed-in admin who signs the server's words", async () => {
    const { challenge, input } = await answer(ADMIN);

    expect(challenge.address).toBe(ADMIN_ADDRESS);
    expect(challenge.message).toContain("Resonate: confirm an admin action");
    expect(challenge.message).toContain(`Account: ${ADMIN_ADDRESS}`);

    const result = await service.verify(ADMIN, input);
    expect(result.ttlSeconds).toBe(300);
    expect(Date.parse(result.expiresAt) - Date.now()).toBeLessThanOrEqual(300_000);
    expect(Date.parse(result.expiresAt) - Date.now()).toBeGreaterThan(290_000);

    // The proof is for this admin and nobody else.
    expect(tokens.checkProof(result.proof, ADMIN).ok).toBe(true);
    expect(tokens.checkProof(result.proof, OTHER_ADMIN).ok).toBe(false);
  });

  it("records every accepted confirmation in the durable audit log", async () => {
    const { input } = await answer(ADMIN);
    await service.verify(ADMIN, input);

    const events = await eventsFor(ADMIN);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "admin.step_up_verified",
      outcome: "success",
      targetUserId: null,
      detail: { mode: "eoa", ttlSeconds: 300 },
    });
  });

  it("refuses a signature from a key that is not the admin's, records it, and issues nothing", async () => {
    const { input } = await answer(ADMIN, strangerKey);

    await expect(service.verify(ADMIN, input)).rejects.toBeInstanceOf(BadRequestException);

    const events = await eventsFor(ADMIN);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      action: "admin.step_up_refused",
      outcome: "denied",
      detail: { reason: "signature_mismatch" },
    });
    // Never the signature itself.
    expect(JSON.stringify(events[0].detail)).not.toContain(input.signature);
  });

  it("refuses a signature over different words, even from the right key", async () => {
    const challenge = await service.challenge(ADMIN);
    const wrongWords = buildAccountClosureMessage({ address: ADMIN_ADDRESS, nonce: "whatever" });
    const signature = await adminKey.signMessage({ message: wrongWords });

    await expect(
      service.verify(ADMIN, { address: challenge.address, signature, challengeToken: challenge.challengeToken }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect((await eventsFor(ADMIN))[0]).toMatchObject({ outcome: "denied", detail: { reason: "signature_mismatch" } });
  });

  it("refuses a message the client built for a nonce the server did not issue", async () => {
    const challenge = await service.challenge(ADMIN);
    const signature = await adminKey.signMessage({
      message: buildAdminStepUpMessage({ address: ADMIN_ADDRESS, nonce: "chosen-by-the-client" }),
    });
    await expect(
      service.verify(ADMIN, { address: challenge.address, signature, challengeToken: challenge.challengeToken }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it("spends the challenge: a good signature cannot be replayed, and a failed one burns it", async () => {
    const first = await answer(ADMIN);
    await service.verify(ADMIN, first.input);
    await expect(service.verify(ADMIN, first.input)).rejects.toBeInstanceOf(BadRequestException);

    const burned = await answer(ADMIN, strangerKey);
    await expect(service.verify(ADMIN, burned.input)).rejects.toBeInstanceOf(BadRequestException);
    const retry = await adminKey.signMessage({ message: burned.challenge.message });
    await expect(
      service.verify(ADMIN, { ...burned.input, signature: retry }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const reasons = (await eventsFor(ADMIN)).filter((e) => e.outcome === "denied").map((e) => (e.detail as any).reason);
    expect(reasons).toEqual(["challenge_spent", "signature_mismatch", "challenge_spent"]);
  });

  it("refuses another admin's challenge, and a tampered or garbage one", async () => {
    const theirs = await answer(OTHER_ADMIN, otherKey);
    await expect(service.verify(ADMIN, theirs.input)).rejects.toBeInstanceOf(BadRequestException);

    const mine = await answer(ADMIN);
    const [body, mac] = mine.challenge.challengeToken.split(".");
    await expect(
      service.verify(ADMIN, { ...mine.input, challengeToken: `${body}.${mac.slice(0, -2)}AA` }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.verify(ADMIN, { ...mine.input, challengeToken: "garbage-garbage" }),
    ).rejects.toBeInstanceOf(BadRequestException);

    const reasons = (await eventsFor(ADMIN)).map((e) => (e.detail as any).reason);
    expect(reasons).toEqual(["challenge_invalid", "challenge_invalid", "challenge_invalid"]);
  });

  it("answers 403 for an address that is not this account's", async () => {
    const challenge = await service.challenge(ADMIN);
    const signature = await strangerKey.signMessage({ message: challenge.message });
    await expect(
      service.verify(ADMIN, {
        address: strangerKey.address,
        signature,
        challengeToken: challenge.challengeToken,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect((await eventsFor(ADMIN))[0]).toMatchObject({ outcome: "denied", detail: { reason: "wrong_account" } });
  });

  it("refuses to start for an account that has no address to sign with", async () => {
    await expect(service.challenge(NO_WALLET)).rejects.toBeInstanceOf(BadRequestException);
  });

  it("does not issue a proof when its audit record cannot be written", async () => {
    const { input } = await answer(ADMIN);
    const spy = jest.spyOn(prisma.adminAuditEvent, "create").mockRejectedValueOnce(new Error("db down"));
    try {
      await expect(service.verify(ADMIN, input)).rejects.toThrow("db down");
    } finally {
      spy.mockRestore();
    }
  });
});
