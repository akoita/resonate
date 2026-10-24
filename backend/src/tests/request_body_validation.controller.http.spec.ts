/**
 * Request body validation for the controllers converted to class DTOs (#2197).
 *
 * For every converted route: a wrong-typed field answers `400` before the
 * handler runs, and a well-typed body is not refused by the pipe. The services
 * are empty stubs, so a body that gets past validation fails later (usually a
 * 500 from the stub); the test only asserts that the answer is not a `400` from
 * validation. The inline-auth exception (`/auth/login`) is covered as well.
 */

import "reflect-metadata";
import { INestApplication, Type } from "@nestjs/common";
import request from "supertest";
import { AgentConfigController } from "../modules/agents/agent_config.controller";
import { AgentsController } from "../modules/agents/agents.controller";
import { ArtistController } from "../modules/artist/artist.controller";
import { AuthController } from "../modules/auth/auth.controller";
import { CatalogController } from "../modules/catalog/catalog.controller";
import { MetadataController } from "../modules/contracts/metadata.controller";
import { MintAuthorizationController } from "../modules/contracts/mint-authorization.controller";
import { CurationController } from "../modules/curation/curation.controller";
import { EncryptionController } from "../modules/encryption/encryption.controller";
import { GenerationController } from "../modules/generation/generation.controller";
import { WalletController } from "../modules/identity/wallet.controller";
import { LibraryController } from "../modules/library/library.controller";
import { PlaylistController } from "../modules/playlist/playlist.controller";
import { StemPricingController } from "../modules/pricing/stem-pricing.controller";
import { PrivacyController } from "../modules/privacy/privacy.controller";
import { RecommendationsController } from "../modules/recommendations/recommendations.controller";
import { RemixController } from "../modules/remix/remix.controller";
import { WebAuthnController } from "../modules/webauthn/webauthn.controller";
import { authToken, createControllerTestApp } from "./e2e-helpers";
import { restoreEnv } from "./env-helpers";

type Verb = "post" | "put" | "patch" | "delete";
type Case = {
  name: string;
  verb: Verb;
  url: string;
  /** A body the DTO must refuse with 400. */
  bad: Record<string, unknown>;
  /** A well-typed body the pipe must let through. */
  ok: Record<string, unknown>;
};

/** Stub every constructor dependency (class or `@Inject` token) with an empty object. */
function stubProviders(controller: Type<unknown>) {
  const classes: unknown[] = Reflect.getMetadata("design:paramtypes", controller) ?? [];
  const injected: Array<{ index: number; param: unknown }> =
    Reflect.getMetadata("self:paramtypes", controller) ?? [];
  const providers = new Map<unknown, { provide: unknown; useValue: object }>();
  classes.forEach((token, index) => {
    const override = injected.find((entry) => entry.index === index)?.param;
    let resolved = override ?? token;
    if (resolved && typeof resolved === "object" && "forwardRef" in resolved) {
      resolved = (resolved as { forwardRef: () => unknown }).forwardRef();
    }
    if (resolved && resolved !== Object) providers.set(resolved, { provide: resolved, useValue: {} });
  });
  return [...providers.values()];
}

const admin = authToken("admin-1", "admin");

const SUITES: Array<{ controller: Type<unknown>; cases: Case[] }> = [
  {
    controller: LibraryController,
    cases: [
      { name: "save a track", verb: "post", url: "/library/tracks", bad: { title: 5 }, ok: { title: "t" } },
      { name: "save a track with a fractional year", verb: "post", url: "/library/tracks", bad: { title: "t", year: 1999.5 }, ok: { title: "t", year: 1999 } },
      { name: "save tracks", verb: "post", url: "/library/tracks/batch", bad: { tracks: "x" }, ok: { tracks: [] } },
      { name: "save tracks with a bad entry", verb: "post", url: "/library/tracks/batch", bad: { tracks: [{ title: 3 }] }, ok: { tracks: [{ title: "t" }] } },
      { name: "delete tracks", verb: "delete", url: "/library/tracks/batch", bad: { ids: "x" }, ok: { ids: [] } },
    ],
  },
  {
    controller: PlaylistController,
    cases: [
      { name: "save a playlist", verb: "post", url: "/playlists/saved", bad: { sourcePlaylistId: 1 }, ok: { sourcePlaylistId: "p" } },
      { name: "create a folder", verb: "post", url: "/playlists/folders", bad: { name: 1 }, ok: { name: "f" } },
      { name: "rename a folder", verb: "put", url: "/playlists/folders/f1", bad: { name: 1 }, ok: { name: "f" } },
      { name: "create a playlist", verb: "post", url: "/playlists", bad: { name: 1 }, ok: { name: "p", trackIds: ["t"] } },
      { name: "update a playlist", verb: "put", url: "/playlists/p1", bad: { trackIds: "x" }, ok: { name: "p", folderId: null } },
    ],
  },
  {
    controller: CurationController,
    cases: [
      { name: "stake", verb: "post", url: "/curation/stake", bad: { curatorId: "c", amountUsd: "5" }, ok: { curatorId: "c", amountUsd: 5 } },
      { name: "report", verb: "post", url: "/curation/report", bad: { curatorId: "c", trackId: 1, reason: "r" }, ok: { curatorId: "c", trackId: "t", reason: "r" } },
    ],
  },
  {
    controller: AuthController,
    cases: [
      { name: "nonce", verb: "post", url: "/auth/nonce", bad: { address: 5 }, ok: { address: "0xabc" } },
      { name: "verify", verb: "post", url: "/auth/verify", bad: { address: "0xabc", message: "m", signature: 5 }, ok: { address: "0xabc", message: "m", signature: "0x00" } },
      { name: "verify with a string chain id", verb: "post", url: "/auth/verify", bad: { address: "0xabc", message: "m", signature: "0x00", chainId: "31337" }, ok: { address: "0xabc", message: "m", signature: "0x00", chainId: 31337 } },
    ],
  },
  {
    controller: WebAuthnController,
    cases: [
      { name: "register options", verb: "post", url: "/api/passkeys/register/options", bad: { username: 5 }, ok: { username: "u" } },
      { name: "register verify", verb: "post", url: "/api/passkeys/register/verify", bad: { userId: "u", cred: "x" }, ok: { userId: "u", cred: {} } },
      { name: "login options", verb: "post", url: "/api/passkeys/login/options", bad: { rpID: 5 }, ok: {} },
      { name: "login verify", verb: "post", url: "/api/passkeys/login/verify", bad: { cred: 5 }, ok: { cred: { id: "c" } } },
    ],
  },
  {
    controller: EncryptionController,
    cases: [
      { name: "decrypt", verb: "post", url: "/encryption/decrypt", bad: { uri: 5, authSig: {} }, ok: { uri: "u", authSig: { address: "0x1" } } },
      { name: "download", verb: "post", url: "/encryption/download", bad: { stemId: 5, walletAddress: "0x1" }, ok: { stemId: "s", walletAddress: "0x1" } },
    ],
  },
  {
    controller: PrivacyController,
    cases: [
      { name: "account closure", verb: "post", url: "/privacy/account/closure", bad: { address: 5 }, ok: { address: "0x1", signature: "0x2" } },
    ],
  },
  {
    controller: StemPricingController,
    cases: [
      { name: "upsert pricing", verb: "put", url: "/api/stem-pricing/s1", bad: { basePlayPriceUsd: "1" }, ok: { basePlayPriceUsd: 1 } },
      { name: "batch pricing", verb: "post", url: "/api/stem-pricing/batch", bad: { releaseId: 1 }, ok: { releaseId: "r", floorUsd: 1 } },
      { name: "batch upsert pricing", verb: "post", url: "/api/stem-pricing/batch-upsert", bad: { releaseId: "r", pricingMap: "x" }, ok: { releaseId: "r", pricingMap: {} } },
    ],
  },
  {
    controller: CatalogController,
    cases: [
      { name: "create a release", verb: "post", url: "/catalog", bad: { title: 5 }, ok: { title: "t" } },
      { name: "create a release with a bad track", verb: "post", url: "/catalog", bad: { title: "t", tracks: [{ title: 1, position: 1 }] }, ok: { title: "t", tracks: [{ title: "a", position: 1, aiDisclosure: { level: "none" } }] } },
      { name: "update a release", verb: "patch", url: "/catalog/releases/r1", bad: { title: 5 }, ok: { title: "t" } },
    ],
  },
  {
    controller: ArtistController,
    cases: [
      { name: "create an artist profile", verb: "post", url: "/artists", bad: { displayName: 5, payoutAddress: "0x1" }, ok: { displayName: "a", payoutAddress: "0x1" } },
    ],
  },
  {
    controller: AgentConfigController,
    cases: [
      { name: "create the config", verb: "post", url: "/agents/config", bad: { name: "n", vibes: "x", monthlyCapUsd: 1 }, ok: { name: "n", vibes: ["a"], monthlyCapUsd: 1 } },
      { name: "update the config", verb: "patch", url: "/agents/config", bad: { vibes: "x" }, ok: { name: "n" } },
      { name: "record a signal", verb: "post", url: "/agents/config/signals", bad: { trackId: 5, action: "skip" }, ok: { trackId: "t", action: "skip" } },
      { name: "start a session", verb: "post", url: "/agents/config/session", bad: { preferences: { genres: "x" } }, ok: { preferences: { genres: ["x"] } } },
      { name: "start a session with a bad mood", verb: "post", url: "/agents/config/session", bad: { preferences: { mood: 3 } }, ok: { preferences: { mood: "calm" } } },
    ],
  },
  {
    controller: AgentsController,
    cases: [
      { name: "run", verb: "post", url: "/agents/run", bad: { sessionId: 1 }, ok: { sessionId: "s", userId: "u", trackId: "t", recentTrackIds: [], budgetRemainingUsd: 1, preferences: {} } },
      { name: "orchestrate", verb: "post", url: "/agents/orchestrate", bad: { sessionId: "s", userId: "u", recentTrackIds: "x", budgetRemainingUsd: 1, preferences: {} }, ok: { sessionId: "s", userId: "u", recentTrackIds: [], budgetRemainingUsd: 1, preferences: { mood: "m" } } },
      { name: "evaluate", verb: "post", url: "/agents/evaluate", bad: { sessions: "x" }, ok: { sessions: [] } },
      { name: "runtime", verb: "post", url: "/agents/runtime", bad: { sessionId: "s", userId: "u", recentTrackIds: [], budgetRemainingUsd: "1", preferences: {} }, ok: { sessionId: "s", userId: "u", recentTrackIds: [], budgetRemainingUsd: 1, preferences: {} } },
    ],
  },
  {
    controller: RecommendationsController,
    cases: [
      { name: "set preferences", verb: "post", url: "/recommendations/preferences", bad: { userId: "admin-1", preferences: { genres: "x" } }, ok: { userId: "admin-1", preferences: { genres: ["x"] } } },
    ],
  },
  {
    controller: RemixController,
    cases: [
      { name: "legacy create", verb: "post", url: "/remix/create", bad: { sourceTrackId: 1, stemIds: [], title: "t" }, ok: { sourceTrackId: "t", stemIds: ["s"], title: "t" } },
    ],
  },
  {
    controller: GenerationController,
    cases: [
      { name: "artwork", verb: "post", url: "/generation/artwork", bad: { prompt: 5 }, ok: { prompt: "a cover" } },
    ],
  },
  {
    controller: WalletController,
    cases: [
      { name: "fund", verb: "post", url: "/wallet/fund", bad: { userId: "admin-1", amountUsd: "5" }, ok: { userId: "admin-1", amountUsd: 5 } },
      { name: "budget", verb: "post", url: "/wallet/budget", bad: { userId: "admin-1", monthlyCapUsd: "5" }, ok: { userId: "admin-1", monthlyCapUsd: 5, resetSpent: true } },
      { name: "set provider", verb: "post", url: "/wallet/provider", bad: { userId: 1, provider: "local" }, ok: { userId: "u", provider: "local" } },
      { name: "refresh", verb: "post", url: "/wallet/refresh", bad: { userId: "u", provider: 3 }, ok: { userId: "u" } },
      { name: "configure paymaster", verb: "post", url: "/wallet/paymaster", bad: { sponsorMaxUsd: "1", paymasterAddress: "0x1" }, ok: { sponsorMaxUsd: 1, paymasterAddress: "0x1" } },
      { name: "reset paymaster", verb: "post", url: "/wallet/paymaster/reset", bad: { userId: 1 }, ok: { userId: "u" } },
      { name: "create a session key", verb: "post", url: "/wallet/session-key", bad: { userId: "u", scope: "s", ttlSeconds: "60" }, ok: { userId: "u", scope: "s", ttlSeconds: 60 } },
      { name: "validate a session key", verb: "post", url: "/wallet/session-key/validate", bad: { token: 1, scope: "s" }, ok: { token: "t", scope: "s" } },
      { name: "set guardians", verb: "post", url: "/wallet/guardians", bad: { userId: "u", guardians: "x", required: 1 }, ok: { userId: "u", guardians: ["a"], required: 1 } },
      { name: "request recovery", verb: "post", url: "/wallet/recovery/request", bad: { userId: "u", newOwner: "o", required: "1" }, ok: { userId: "u", newOwner: "o", required: 1 } },
      { name: "approve recovery", verb: "post", url: "/wallet/recovery/approve", bad: { requestId: 1, guardian: "g" }, ok: { requestId: "r", guardian: "g" } },
      { name: "enable the agent wallet", verb: "post", url: "/wallet/agent/enable", bad: { permissions: { target: 1 } }, ok: { validityHours: 2 } },
      { name: "activate the session key", verb: "post", url: "/wallet/agent/session-key/activate", bad: { approvalData: 5 }, ok: { approvalData: "a" } },
      { name: "disable the agent wallet", verb: "delete", url: "/wallet/agent/session-key", bad: { revokeTxHash: 5 }, ok: { revokeTxHash: "0x1" } },
      { name: "rotate the agent key", verb: "post", url: "/wallet/agent/rotate", bad: { validityHours: "2" }, ok: { validityHours: 2 } },
      { name: "agent purchase", verb: "post", url: "/wallet/agent/purchase", bad: { sessionId: "s", listingId: "1", tokenId: "1", amount: "1", totalPriceWei: "1", priceUsd: "1" }, ok: { sessionId: "s", listingId: "1", tokenId: "1", amount: "1", totalPriceWei: "1", priceUsd: 1 } },
    ],
  },
  {
    controller: MintAuthorizationController,
    cases: [
      { name: "batch mint authorizations", verb: "post", url: "/contracts/mint-authorizations/batch", bad: { authorizations: "x" }, ok: {} },
    ],
  },
  {
    controller: MetadataController,
    cases: [
      { name: "notification preferences", verb: "patch", url: "/metadata/notifications/0xabc/preferences", bad: { disputeFiled: "yes" }, ok: { disputeFiled: true } },
      { name: "curator verification", verb: "post", url: "/metadata/curators/0xabc/verification", bad: { provider: 5 }, ok: { provider: "mock" } },
      { name: "dispute evidence", verb: "post", url: "/metadata/disputes/1/evidence", bad: { submitter: 5, party: "p", evidenceURI: "u" }, ok: { submitter: "s", party: "p", evidenceURI: "u" } },
      { name: "escalate to jury", verb: "patch", url: "/metadata/disputes/1/escalate-jury", bad: { jurors: "x" }, ok: { jurors: ["a", "b", "c"], deadlineHours: "48" } },
      { name: "jury vote", verb: "patch", url: "/metadata/disputes/1/jury-vote", bad: { jurorAddr: 5, vote: "reporter" }, ok: { jurorAddr: "0x1", vote: "reporter" } },
      { name: "trusted source link request", verb: "post", url: "/metadata/trusted-sources/link-requests", bad: { sourceName: 5 }, ok: { sourceName: "s" } },
      { name: "trusted source link review", verb: "patch", url: "/metadata/trusted-sources/link-requests/1/review", bad: { action: 5 }, ok: { action: "deny" } },
      { name: "trusted source link revoke", verb: "patch", url: "/metadata/trusted-sources/links/1/revoke", bad: { reason: 5 }, ok: { reason: "r" } },
      { name: "release rights request", verb: "post", url: "/metadata/release-rights/releases/r1/request", bad: { evidences: "x" }, ok: { evidences: [] } },
      { name: "release rights review", verb: "patch", url: "/metadata/release-rights/requests/1/review", bad: { action: 5 }, ok: { action: "denied" } },
      { name: "rights reassessment", verb: "post", url: "/metadata/rights-reassessments/releases/r1", bad: { flags: "x" }, ok: { flags: ["f"] } },
      { name: "rights reassessment review", verb: "patch", url: "/metadata/rights-reassessments/1/review", bad: { action: 5 }, ok: { action: "dismiss" } },
    ],
  },
];

describe("converted request bodies (HTTP, #2197)", () => {
  for (const { controller, cases } of SUITES) {
    describe(controller.name, () => {
      let app: INestApplication;

      beforeAll(async () => {
        app = await createControllerTestApp(controller, stubProviders(controller));
      });

      afterAll(async () => {
        await app.close();
      });

      for (const testCase of cases) {
        it(`${testCase.name}: a wrong-typed body answers 400`, async () => {
          const res = await request(app.getHttpServer())
            [testCase.verb](testCase.url)
            .set("Authorization", `Bearer ${admin}`)
            .send(testCase.bad);
          expect(res.status).toBe(400);
          expect(JSON.stringify(res.body)).toMatch(/must be|should not be empty|must contain|must be an? /);
        });

        it(`${testCase.name}: a well-typed body is not refused by validation`, async () => {
          const res = await request(app.getHttpServer())
            [testCase.verb](testCase.url)
            .set("Authorization", `Bearer ${admin}`)
            .send(testCase.ok);
          const validationMessage = JSON.stringify(res.body);
          expect(
            res.status !== 400 || !/must be (a|an) (string|number|boolean|array|object)/.test(validationMessage),
          ).toBe(true);
        });
      }
    });
  }
});

describe("AuthController login (body checked inline after the flag)", () => {
  let app: INestApplication;
  let original: string | undefined;

  beforeAll(async () => {
    original = process.env.AUTH_DEV_LOGIN_ENABLED;
    app = await createControllerTestApp(AuthController, stubProviders(AuthController));
  });

  afterAll(async () => {
    await app.close();
    restoreEnv("AUTH_DEV_LOGIN_ENABLED", original);
  });

  it("answers 403 to every body while the route is disabled", async () => {
    delete process.env.AUTH_DEV_LOGIN_ENABLED;
    await request(app.getHttpServer()).post("/auth/login").send({ userId: 5 }).expect(403);
    await request(app.getHttpServer()).post("/auth/login").send({}).expect(403);
  });

  it("answers 400 to a wrong-typed body once the route is enabled", async () => {
    process.env.AUTH_DEV_LOGIN_ENABLED = "true";
    await request(app.getHttpServer()).post("/auth/login").send({ userId: 5 }).expect(400);
    await request(app.getHttpServer()).post("/auth/login").send({ userId: "u", role: 3 }).expect(400);
  });
});
