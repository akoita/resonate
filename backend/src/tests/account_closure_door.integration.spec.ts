/**
 * The account-closure door, end to end against a real Postgres (#1771 slice 3b).
 *
 * The state machine has its own suite; this one is about the journey a person
 * actually takes: ask for the words, sign them, see the deletion pending, and
 * stop it — either by cancelling or, crucially, just by signing in.
 *
 * Nothing here is mocked that touches data: real `AccountClosureService`, real
 * `AuthService` against the real `Wallet` table, real `AuthNonceService`, real
 * signatures from a real key, and a real viem client against the Testcontainer
 * Anvil. Only the JWT signer, the audit log and the event bus are stubs, and
 * none of them decide anything this file asserts.
 */
import { createPublicClient, http, type PublicClient } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AccountClosureStatus } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  ACCOUNT_CLOSURE_WINDOW_MS,
  AccountClosureService,
} from "../modules/privacy/account_closure.service";
import { AccountClosureStepUpService } from "../modules/privacy/account_closure_step_up.service";
import { PrivacyController } from "../modules/privacy/privacy.controller";
import { AuthController } from "../modules/auth/auth.controller";
import { AuthService } from "../modules/auth/auth.service";
import { AuthNonceService } from "../modules/auth/auth_nonce.service";

const TEST_PREFIX = `closure_door_${Date.now()}_`;

/** The person using the door. Their id is not an address; their wallet is. */
const DOOR_USER = `${TEST_PREFIX}user`;
const doorKey = privateKeyToAccount(generatePrivateKey());
const DOOR_ADDRESS = doorKey.address.toLowerCase();

/** A wallet-authenticated person, whose user id is their address, as sign-in creates. */
const signInKey = privateKeyToAccount(generatePrivateKey());
const SIGN_IN_USER = signInKey.address.toLowerCase();

const USER_IDS = [DOOR_USER, SIGN_IN_USER];

const mockJwt = { sign: jest.fn().mockReturnValue("mock-jwt-token") };
const mockAudit = { log: jest.fn() };
const mockEventBus = { publish: jest.fn() };

const nonceService = new AuthNonceService();
const authService = new AuthService(mockJwt as any, mockAudit as any);
const closureService = new AccountClosureService();

let publicClient: PublicClient;
let privacyController: PrivacyController;
let authController: AuthController;

const asUser = (userId: string) => ({ user: { userId } }) as any;

/** Walk the whole door: challenge, sign, submit. */
async function scheduleClosure(userId: string, reason?: string) {
  const challenge = await privacyController.requestAccountClosureChallenge(asUser(userId));
  const signature = await doorKey.signMessage({ message: challenge.message });
  const response = await privacyController.requestAccountClosure(asUser(userId), {
    address: challenge.address,
    signature,
    reason,
  });
  return { challenge, response };
}

beforeAll(async () => {
  const rpcUrl = process.env.ANVIL_RPC_URL;
  if (!rpcUrl) throw new Error("ANVIL_RPC_URL is not set; the Testcontainer Anvil did not start");
  publicClient = createPublicClient({ transport: http(rpcUrl) }) as PublicClient;

  const stepUp = new AccountClosureStepUpService(authService, nonceService, publicClient);
  privacyController = new PrivacyController({} as any, closureService, stepUp);
  authController = new AuthController(
    authService,
    nonceService,
    publicClient,
    mockEventBus as any,
    closureService,
  );

  for (const id of USER_IDS) {
    await prisma.user.create({ data: { id, email: `${id}@test.resonate` } });
  }
  // The door user signs with a wallet whose row is the only thing tying the
  // address to the account — exactly the lookup `isAddressForUser` does.
  await prisma.wallet.create({
    data: { userId: DOOR_USER, address: DOOR_ADDRESS, chainId: 31337 },
  });
});

afterEach(async () => {
  await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: USER_IDS } } });
  jest.clearAllMocks();
  mockJwt.sign.mockReturnValue("mock-jwt-token");
});

afterAll(async () => {
  await prisma.accountClosureRequest.deleteMany({ where: { userId: { in: USER_IDS } } });
  await prisma.wallet.deleteMany({ where: { userId: { in: USER_IDS } } });
  await prisma.passkeyIdentity.deleteMany({ where: { userId: { in: USER_IDS } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: USER_IDS } } });
  await prisma.$disconnect();
});

describe("Account closure door (integration)", () => {
  it("schedules the erasure a window out when the person signs the words that say so", async () => {
    const { challenge, response } = await scheduleClosure(DOOR_USER, "leaving");

    // The address came from the account, and the message names the action.
    expect(challenge.address).toBe(DOOR_ADDRESS);
    expect(challenge.message).toContain("Resonate: delete my account");
    expect(challenge.message).toContain(`Account: ${DOOR_ADDRESS}`);

    expect(response.windowDays).toBe(30);
    expect(response.request).not.toBeNull();
    expect(response.request!.status).toBe(AccountClosureStatus.pending);
    expect(response.request!.reason).toBe("leaving");

    const row = await prisma.accountClosureRequest.findFirstOrThrow({
      where: { userId: DOOR_USER },
    });
    expect(row.status).toBe(AccountClosureStatus.pending);
    expect(row.dueAt.getTime() - row.requestedAt.getTime()).toBe(ACCOUNT_CLOSURE_WINDOW_MS);
    expect(response.request!.dueAt).toBe(row.dueAt.toISOString());
    // Thirty days out, not now.
    expect(row.dueAt.getTime()).toBeGreaterThan(Date.now() + 29 * 24 * 60 * 60 * 1000);
  });

  it("shows the person their own pending request", async () => {
    const empty = await privacyController.getAccountClosure(asUser(DOOR_USER));
    expect(empty.request).toBeNull();

    const { response } = await scheduleClosure(DOOR_USER);
    const pending = await privacyController.getAccountClosure(asUser(DOOR_USER));

    expect(pending.request).toEqual(response.request);
  });

  it("is idempotent: asking twice does not stack requests or push the date out", async () => {
    const first = await scheduleClosure(DOOR_USER, "first reason");
    const second = await scheduleClosure(DOOR_USER, "second reason");

    expect(second.response.request!.id).toBe(first.response.request!.id);
    expect(second.response.request!.dueAt).toBe(first.response.request!.dueAt);
    expect(second.response.request!.reason).toBe("first reason");
    // And the second walk through the door was a genuinely fresh challenge.
    expect(second.challenge.nonce).not.toBe(first.challenge.nonce);

    const rows = await prisma.accountClosureRequest.findMany({ where: { userId: DOOR_USER } });
    expect(rows).toHaveLength(1);
  });

  it("clears the request when the person cancels, with no signature asked for", async () => {
    await scheduleClosure(DOOR_USER);

    const cancelled = await privacyController.cancelAccountClosure(asUser(DOOR_USER));
    expect(cancelled.cancelled).toBe(true);

    expect((await privacyController.getAccountClosure(asUser(DOOR_USER))).request).toBeNull();

    const row = await prisma.accountClosureRequest.findFirstOrThrow({
      where: { userId: DOOR_USER },
    });
    expect(row.status).toBe(AccountClosureStatus.cancelled);
    expect(row.cancelledAt).not.toBeNull();
  });

  it("reports a cancellation with nothing pending rather than failing", async () => {
    const result = await privacyController.cancelAccountClosure(asUser(DOOR_USER));
    expect(result.cancelled).toBe(false);
  });

  it("takes a cancelled request out of the erasure engine's queue", async () => {
    await scheduleClosure(DOOR_USER);
    // Reach the due date without waiting thirty days.
    await prisma.accountClosureRequest.updateMany({
      where: { userId: DOOR_USER },
      data: { dueAt: new Date(Date.now() - 60_000) },
    });

    const beforeCancel = await closureService.listDue(new Date());
    expect(beforeCancel.map((row) => row.userId)).toContain(DOOR_USER);

    await privacyController.cancelAccountClosure(asUser(DOOR_USER));

    const afterCancel = await closureService.listDue(new Date());
    expect(afterCancel.map((row) => row.userId)).not.toContain(DOOR_USER);
  });

  describe("signing in", () => {
    /** A sign-in exactly as `/auth/verify` receives one. */
    async function signIn() {
      const nonce = nonceService.issue(SIGN_IN_USER);
      const message = `Sign in to Resonate\nNonce: ${nonce}`;
      const signature = await signInKey.signMessage({ message });
      return authController.verify({ address: SIGN_IN_USER, message, signature });
    }

    it("cancels a pending closure, because it is the only warning a person gets", async () => {
      const scheduled = await closureService.request(SIGN_IN_USER, "regret this later");
      expect(scheduled.status).toBe(AccountClosureStatus.pending);

      const result = await signIn();
      expect(result).toHaveProperty("accessToken");

      expect(await closureService.findPending(SIGN_IN_USER)).toBeNull();
      const row = await prisma.accountClosureRequest.findUniqueOrThrow({
        where: { id: scheduled.id },
      });
      expect(row.status).toBe(AccountClosureStatus.cancelled);
      expect(row.cancelledAt).not.toBeNull();
    });

    it("succeeds with nothing to cancel, which is almost every sign-in", async () => {
      const result = await signIn();
      expect(result).toHaveProperty("accessToken");
      expect(
        await prisma.accountClosureRequest.count({ where: { userId: SIGN_IN_USER } }),
      ).toBe(0);
    });

    it("still signs the person in when the cancel fails, rather than locking them out", async () => {
      // Being locked out is the exact condition that lets an erasure run, so a
      // failed cancel must never become a failed sign-in.
      const cancel = jest
        .spyOn(closureService, "cancel")
        .mockRejectedValueOnce(new Error("database is on fire"));

      const result = await signIn();
      expect(result).toHaveProperty("accessToken");
      expect(cancel).toHaveBeenCalledWith(SIGN_IN_USER);
      cancel.mockRestore();
    });
  });
});
