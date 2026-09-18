/**
 * The door a person walks through to close their own account (#1771 slice 3b).
 *
 * HTTP contract only: who is allowed in, whose id is used, and what the
 * step-up will and will not accept. The state machine behind it has its own
 * suite (`account_closure.integration.spec.ts`), and the end-to-end journey —
 * request, see it pending, cancel, and cancel-by-signing-in — lives in
 * `account_closure_door.integration.spec.ts`.
 *
 * The signatures here are real: `privateKeyToAccount` signs, and the service
 * recovers. Mocking the crypto would leave the one assertion this file exists
 * for — that a signature over *different words* is refused — testing nothing
 * but a stub's return value.
 */
import { INestApplication } from "@nestjs/common";
import { THROTTLER_TRACKER, THROTTLER_TTL } from "@nestjs/throttler/dist/throttler.constants";
import request from "supertest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { AccountClosureService } from "../modules/privacy/account_closure.service";
import { AccountClosureStepUpService } from "../modules/privacy/account_closure_step_up.service";
import { PersonalDataExportService } from "../modules/privacy/personal_data_export.service";
import { PrivacyController } from "../modules/privacy/privacy.controller";
import { AuthService } from "../modules/auth/auth.service";
import { AuthNonceService } from "../modules/auth/auth_nonce.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const owner = privateKeyToAccount(generatePrivateKey());
const stranger = privateKeyToAccount(generatePrivateKey());
const OWNER_ADDRESS = owner.address.toLowerCase();
const STRANGER_ADDRESS = stranger.address.toLowerCase();
const USER_ID = OWNER_ADDRESS;

function pendingRow(userId: string, reason: string | null = null) {
  const requestedAt = new Date("2026-09-18T10:00:00.000Z");
  return {
    id: `closure-${userId}`,
    userId,
    status: "pending",
    requestedAt,
    dueAt: new Date(requestedAt.getTime() + 30 * 24 * 60 * 60 * 1000),
    cancelledAt: null,
    completedAt: null,
    failedAt: null,
    reason,
    // Operator-facing, and must never reach the response.
    failureMessage: "internal erasure detail",
  };
}

const closureService = {
  request: jest.fn(),
  cancel: jest.fn(),
  findPending: jest.fn(),
};

const authService = {
  findSigningAddressForUser: jest.fn(),
  isAddressForUser: jest.fn(),
};

const publicClient = {
  getChainId: jest.fn(),
  getCode: jest.fn(),
  verifyMessage: jest.fn(),
};

describe("Account closure door (HTTP)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    app = await createControllerTestApp(PrivacyController, [
      { provide: PersonalDataExportService, useValue: { prepare: jest.fn() } },
      { provide: AccountClosureService, useValue: closureService },
      // The step-up itself is real; only its collaborators are stubbed.
      AccountClosureStepUpService,
      { provide: AuthService, useValue: authService },
      // Real nonce service: single use is part of what this file asserts.
      AuthNonceService,
      { provide: "PUBLIC_CLIENT", useValue: publicClient },
    ]);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    closureService.request.mockImplementation(async (userId: string, reason?: string | null) =>
      pendingRow(userId, reason?.trim() || null),
    );
    closureService.cancel.mockImplementation(async (userId: string) => pendingRow(userId));
    closureService.findPending.mockResolvedValue(null);
    authService.findSigningAddressForUser.mockResolvedValue(OWNER_ADDRESS);
    authService.isAddressForUser.mockImplementation(
      async (_userId: string, address: string) => address.toLowerCase() === OWNER_ADDRESS,
    );
    publicClient.getChainId.mockResolvedValue(1);
    // No bytecode: a plain EOA, which is also what a counterfactual smart
    // account looks like from here.
    publicClient.getCode.mockResolvedValue("0x");
    publicClient.verifyMessage.mockResolvedValue(false);
  });

  const asOwner = () => `Bearer ${authToken(USER_ID, "listener")}`;

  async function challenge(token = asOwner()) {
    const response = await request(app.getHttpServer())
      .post("/privacy/account/closure/challenge")
      .set("Authorization", token)
      .expect(201);
    return response.body as { address: string; message: string; nonce: string };
  }

  describe("every route is closed to the unauthenticated", () => {
    it("refuses a challenge", async () => {
      await request(app.getHttpServer()).post("/privacy/account/closure/challenge").expect(401);
      expect(authService.findSigningAddressForUser).not.toHaveBeenCalled();
    });

    it("refuses a closure request", async () => {
      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .send({ address: OWNER_ADDRESS, signature: "0xdead" })
        .expect(401);
      expect(closureService.request).not.toHaveBeenCalled();
    });

    it("refuses to read the pending request", async () => {
      await request(app.getHttpServer()).get("/privacy/account/closure").expect(401);
      expect(closureService.findPending).not.toHaveBeenCalled();
    });

    it("refuses a cancellation", async () => {
      await request(app.getHttpServer()).delete("/privacy/account/closure").expect(401);
      expect(closureService.cancel).not.toHaveBeenCalled();
    });

    it("refuses a bearer token that is not ours", async () => {
      await request(app.getHttpServer())
        .post("/privacy/account/closure/challenge")
        .set("Authorization", "Bearer not-a-real-token")
        .expect(401);
    });
  });

  describe("the challenge", () => {
    it("names the action, the address and the nonce", async () => {
      const body = await challenge();

      expect(body.address).toBe(OWNER_ADDRESS);
      expect(body.nonce).toEqual(expect.any(String));
      expect(body.message).toContain("Resonate: delete my account");
      expect(body.message).toContain("erase my personal data");
      expect(body.message).toContain(`Account: ${OWNER_ADDRESS}`);
      expect(body.message).toContain(`Nonce: ${body.nonce}`);
      // The message must say the deletion can be stopped, because signing in is
      // the only channel that can tell a person it was scheduled.
      expect(body.message).toContain("Signing in to Resonate before then cancels it.");
    });

    it("resolves the address from the account, never from the request", async () => {
      await request(app.getHttpServer())
        .post("/privacy/account/closure/challenge")
        .set("Authorization", asOwner())
        .send({ address: STRANGER_ADDRESS, userId: "victim-1" })
        .expect(201);

      expect(authService.findSigningAddressForUser).toHaveBeenCalledTimes(1);
      expect(authService.findSigningAddressForUser).toHaveBeenCalledWith(USER_ID);
    });

    it("says so plainly when the account has no address to sign with", async () => {
      authService.findSigningAddressForUser.mockResolvedValueOnce(null);
      await request(app.getHttpServer())
        .post("/privacy/account/closure/challenge")
        .set("Authorization", asOwner())
        .expect(400);
    });
  });

  describe("the closure request", () => {
    it("schedules the closure for the signed-in person when the signature is theirs", async () => {
      const { message } = await challenge();
      const signature = await owner.signMessage({ message });

      const response = await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS, signature, reason: "  leaving  " })
        .expect(201);

      expect(closureService.request).toHaveBeenCalledTimes(1);
      expect(closureService.request).toHaveBeenCalledWith(USER_ID, "  leaving  ");
      expect(response.body.windowDays).toBe(30);
      expect(response.body.request).toMatchObject({
        status: "pending",
        dueAt: "2026-10-18T10:00:00.000Z",
      });
      // Operator-facing failure detail is never shown to the person.
      expect(response.body.request.failureMessage).toBeUndefined();
      expect(JSON.stringify(response.body)).not.toContain("internal erasure detail");
    });

    it("refuses a signature from an address that is not the caller's", async () => {
      // A valid signature from a wallet the caller really controls — just not
      // one attached to this account. Proving you own *a* wallet is not
      // consenting for *this* account.
      const { message } = await challenge();
      const signature = await stranger.signMessage({ message });

      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: STRANGER_ADDRESS, signature })
        .expect(403);

      expect(closureService.request).not.toHaveBeenCalled();
    });

    it("refuses a signature by a key that is not the claimed address's", async () => {
      const { message } = await challenge();
      const signature = await stranger.signMessage({ message });

      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS, signature })
        .expect(400);

      expect(closureService.request).not.toHaveBeenCalled();
    });

    it("never verifies a message the client supplied", async () => {
      // The attack this route is shaped against: obtain a signature over some
      // other text — here an innocuous sign-in prompt carrying the very same
      // nonce — and submit it as consent to delete an account. The server
      // rebuilds the closure message and checks against that, so the signature
      // recovers to nobody and the request is refused. A `message` field in the
      // body changes nothing, because nothing reads it.
      const { nonce } = await challenge();
      const innocuous = `Sign in to Resonate\nNonce: ${nonce}`;
      const signature = await owner.signMessage({ message: innocuous });

      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS, signature, message: innocuous })
        .expect(400);

      expect(closureService.request).not.toHaveBeenCalled();
    });

    it("refuses a replayed nonce", async () => {
      const { message } = await challenge();
      const signature = await owner.signMessage({ message });

      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS, signature })
        .expect(201);

      // Same address, same signature, same words. The nonce is spent.
      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS, signature })
        .expect(400);

      expect(closureService.request).toHaveBeenCalledTimes(1);
    });

    it("burns the challenge even when the signature fails, so a nonce cannot be ground down", async () => {
      const { message } = await challenge();
      const bad = await stranger.signMessage({ message });
      const good = await owner.signMessage({ message });

      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS, signature: bad })
        .expect(400);

      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS, signature: good })
        .expect(400);

      expect(closureService.request).not.toHaveBeenCalled();
    });

    it("refuses a request with no signature at all", async () => {
      await challenge();
      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS })
        .expect(400);
      expect(closureService.request).not.toHaveBeenCalled();
    });

    it("refuses a signature with no outstanding challenge", async () => {
      const signature = await owner.signMessage({ message: "anything" });
      await request(app.getHttpServer())
        .post("/privacy/account/closure")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS, signature })
        .expect(400);
      expect(closureService.request).not.toHaveBeenCalled();
    });

    it("ignores a user id supplied in the body or the query string", async () => {
      const { message } = await challenge();
      const signature = await owner.signMessage({ message });

      await request(app.getHttpServer())
        .post("/privacy/account/closure?userId=victim-1&user_id=victim-1&subject=victim-1")
        .set("Authorization", asOwner())
        .send({ address: OWNER_ADDRESS, signature, userId: "victim-1", subject: "victim-1" })
        .expect(201);

      expect(closureService.request).toHaveBeenCalledTimes(1);
      expect(closureService.request).toHaveBeenCalledWith(USER_ID, undefined);
      expect(authService.isAddressForUser).toHaveBeenCalledWith(USER_ID, OWNER_ADDRESS);
    });

    it("has no route that takes a user id as a path parameter", async () => {
      await request(app.getHttpServer())
        .post("/privacy/account/closure/victim-1")
        .set("Authorization", asOwner())
        .expect(404);
      await request(app.getHttpServer())
        .delete("/privacy/account/closure/victim-1")
        .set("Authorization", asOwner())
        .expect(404);
      expect(closureService.request).not.toHaveBeenCalled();
      expect(closureService.cancel).not.toHaveBeenCalled();
    });

    it("counts its rate limit against the person, not the address they browse from", () => {
      const handler = PrivacyController.prototype.requestAccountClosure;
      const getTracker = Reflect.getMetadata(`${THROTTLER_TRACKER}default`, handler);
      expect(typeof getTracker).toBe("function");
      expect(getTracker({ user: { userId: "person-a" }, ip: "203.0.113.9" })).toBe("person-a");
      expect(getTracker({ ip: "203.0.113.9" })).toBe("203.0.113.9");
      // Milliseconds — see shared/rate_limits.ts and #1790.
      expect(Reflect.getMetadata(`${THROTTLER_TTL}default`, handler)).toBe(3_600_000);
    });
  });

  describe("reading and cancelling", () => {
    it("reports nothing pending as an explicit null", async () => {
      const response = await request(app.getHttpServer())
        .get("/privacy/account/closure")
        .set("Authorization", asOwner())
        .expect(200);

      expect(response.body).toEqual({ request: null, windowDays: 30 });
      expect(closureService.findPending).toHaveBeenCalledWith(USER_ID);
    });

    it("reports the pending request and when it runs", async () => {
      closureService.findPending.mockResolvedValueOnce(pendingRow(USER_ID, "leaving"));

      const response = await request(app.getHttpServer())
        .get("/privacy/account/closure?userId=victim-1")
        .set("Authorization", asOwner())
        .expect(200);

      expect(response.body.request).toEqual({
        id: `closure-${USER_ID}`,
        status: "pending",
        requestedAt: "2026-09-18T10:00:00.000Z",
        dueAt: "2026-10-18T10:00:00.000Z",
        reason: "leaving",
      });
      expect(closureService.findPending).toHaveBeenCalledWith(USER_ID);
    });

    it("cancels without any signature, deliberately", async () => {
      // The asymmetry is the point: somebody who lost their signer must still
      // be able to stop an irreversible deletion. No challenge is requested,
      // no address is resolved, and no signature is sent.
      const response = await request(app.getHttpServer())
        .delete("/privacy/account/closure")
        .set("Authorization", asOwner())
        .expect(200);

      expect(response.body).toEqual({ cancelled: true, request: null, windowDays: 30 });
      expect(closureService.cancel).toHaveBeenCalledWith(USER_ID);
      expect(authService.findSigningAddressForUser).not.toHaveBeenCalled();
      expect(publicClient.verifyMessage).not.toHaveBeenCalled();
    });

    it("reports a cancellation with nothing to cancel without failing", async () => {
      closureService.cancel.mockResolvedValueOnce(null);
      const response = await request(app.getHttpServer())
        .delete("/privacy/account/closure?userId=victim-1")
        .set("Authorization", asOwner())
        .expect(200);

      expect(response.body.cancelled).toBe(false);
      expect(closureService.cancel).toHaveBeenCalledWith(USER_ID);
    });
  });
});
