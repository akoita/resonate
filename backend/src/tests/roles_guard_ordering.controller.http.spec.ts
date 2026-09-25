/**
 * Global RolesGuard ordering — HTTP + reflection test
 *
 * Nest runs global (APP_GUARD) guards before controller/route guards, so the
 * global RolesGuard sees a request before the route's AuthGuard("jwt") has set
 * `req.user`. These tests prove @Roles routes that rely only on the global
 * guard are still enforced (401 without a JWT, 403 for an under-privileged
 * role), and that every @Roles route authenticates with AuthGuard("jwt"),
 * which is the strategy the global guard uses to authenticate on its own.
 */

import "reflect-metadata";
import { execSync } from "child_process";
import * as path from "path";
import request from "supertest";
import { INestApplication } from "@nestjs/common";
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { AuthGuard } from "@nestjs/passport";
import { ROLES_KEY } from "../modules/auth/roles.decorator";
import { AgentsController } from "../modules/agents/agents.controller";
import { AgentEvaluationService } from "../modules/agents/agent_evaluation.service";
import { AgentGoldenEvalService } from "../modules/agents/agent_golden_eval.service";
import { AgentOrchestratorService } from "../modules/agents/agent_orchestrator.service";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { AgentRunnerService } from "../modules/agents/agent_runner.service";
import { AgentWalletService } from "../modules/agents/agent_wallet.service";
import { AgentPurchaseService } from "../modules/agents/agent_purchase.service";
import { CommunityRoomsService } from "../modules/community/community_rooms.service";
import { CurationController } from "../modules/curation/curation.controller";
import { CurationService } from "../modules/curation/curation.service";
import { SessionKeyService } from "../modules/identity/session_key.service";
import { SocialRecoveryService } from "../modules/identity/social_recovery.service";
import { WalletController } from "../modules/identity/wallet.controller";
import { WalletService } from "../modules/identity/wallet.service";
import { ShowsController } from "../modules/shows/shows.controller";
import { ShowsService } from "../modules/shows/shows.service";
import { authToken, createControllerTestApp } from "./e2e-helpers";

const mockOrchestrator = {
  orchestrate: jest.fn().mockResolvedValue({ status: "approved", tracks: [] }),
};
const mockRuntime = {
  run: jest.fn().mockResolvedValue({ status: "approved", tracks: [] }),
};
const mockWalletService = {
  setProvider: jest.fn().mockResolvedValue({ ok: true }),
};
const mockShowsService = {
  approveAuthority: jest.fn().mockResolvedValue({ id: "campaign-1" }),
};
const mockCurationService = {
  listReports: jest.fn().mockReturnValue([]),
};

const orchestrateBody = {
  sessionId: "s1",
  userId: "u1",
  recentTrackIds: [],
  budgetRemainingUsd: 5,
  preferences: {},
};

describe("global RolesGuard ordering (http)", () => {
  let app: INestApplication;
  const listener = authToken("listener-1", "listener");
  const artist = authToken("artist-1", "artist");
  const operator = authToken("operator-1", "operator");
  const admin = authToken("admin-1", "admin");

  beforeAll(async () => {
    app = await createControllerTestApp(
      [AgentsController, WalletController, ShowsController, CurationController],
      [
        { provide: AgentRunnerService, useValue: {} },
        { provide: AgentOrchestratorService, useValue: mockOrchestrator },
        { provide: AgentEvaluationService, useValue: {} },
        { provide: AgentGoldenEvalService, useValue: {} },
        { provide: AgentRuntimeService, useValue: mockRuntime },
        { provide: WalletService, useValue: mockWalletService },
        { provide: SessionKeyService, useValue: {} },
        { provide: SocialRecoveryService, useValue: {} },
        { provide: AgentWalletService, useValue: {} },
        { provide: AgentPurchaseService, useValue: {} },
        { provide: ShowsService, useValue: mockShowsService },
        { provide: CommunityRoomsService, useValue: {} },
        { provide: CurationService, useValue: mockCurationService },
      ],
    );
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe("POST /agents/orchestrate (@Roles admin, global guard only)", () => {
    it("401 without a JWT", async () => {
      await request(app.getHttpServer())
        .post("/agents/orchestrate")
        .send(orchestrateBody)
        .expect(401);
      expect(mockOrchestrator.orchestrate).not.toHaveBeenCalled();
    });

    it("401 with an invalid JWT", async () => {
      await request(app.getHttpServer())
        .post("/agents/orchestrate")
        .set("Authorization", "Bearer not-a-jwt")
        .send(orchestrateBody)
        .expect(401);
      expect(mockOrchestrator.orchestrate).not.toHaveBeenCalled();
    });

    it("403 for a listener", async () => {
      await request(app.getHttpServer())
        .post("/agents/orchestrate")
        .set("Authorization", `Bearer ${listener}`)
        .send(orchestrateBody)
        .expect(403);
      expect(mockOrchestrator.orchestrate).not.toHaveBeenCalled();
      expect(mockRuntime.run).not.toHaveBeenCalled();
    });

    it("2xx for an admin", async () => {
      await request(app.getHttpServer())
        .post("/agents/orchestrate")
        .set("Authorization", `Bearer ${admin}`)
        .send(orchestrateBody)
        .expect(201);
      expect(mockOrchestrator.orchestrate).toHaveBeenCalledTimes(1);
    });
  });

  describe("POST /wallet/provider (@Roles admin, global guard only)", () => {
    it("403 for a listener", async () => {
      await request(app.getHttpServer())
        .post("/wallet/provider")
        .set("Authorization", `Bearer ${listener}`)
        .send({ userId: "u1", provider: "erc4337" })
        .expect(403);
      expect(mockWalletService.setProvider).not.toHaveBeenCalled();
    });

    it("2xx for an admin", async () => {
      await request(app.getHttpServer())
        .post("/wallet/provider")
        .set("Authorization", `Bearer ${admin}`)
        .send({ userId: "u1", provider: "erc4337" })
        .expect(201);
      expect(mockWalletService.setProvider).toHaveBeenCalledTimes(1);
    });
  });

  describe("PATCH /shows/campaigns/:id/authority (@Roles admin, operator)", () => {
    it("403 for an artist", async () => {
      await request(app.getHttpServer())
        .patch("/shows/campaigns/campaign-1/authority")
        .set("Authorization", `Bearer ${artist}`)
        .send({})
        .expect(403);
      expect(mockShowsService.approveAuthority).not.toHaveBeenCalled();
    });

    it("reaches the service for an operator", async () => {
      await request(app.getHttpServer())
        .patch("/shows/campaigns/campaign-1/authority")
        .set("Authorization", `Bearer ${operator}`)
        .send({})
        .expect(200);
      expect(mockShowsService.approveAuthority).toHaveBeenCalledTimes(1);
    });
  });

  describe("GET /curation/reports (@Roles admin)", () => {
    it("403 for a listener", async () => {
      await request(app.getHttpServer())
        .get("/curation/reports")
        .set("Authorization", `Bearer ${listener}`)
        .expect(403);
      expect(mockCurationService.listReports).not.toHaveBeenCalled();
    });

    it("200 for an admin", async () => {
      await request(app.getHttpServer())
        .get("/curation/reports")
        .set("Authorization", `Bearer ${admin}`)
        .expect(200);
      expect(mockCurationService.listReports).toHaveBeenCalledTimes(1);
    });
  });
});

describe("@Roles routes authenticate with AuthGuard('jwt') (reflection)", () => {
  const JwtAuthGuard = AuthGuard("jwt");
  const srcDir = path.join(__dirname, "..");
  const controllerFiles = execSync("find modules -name '*.controller.ts'", { cwd: srcDir })
    .toString()
    .split("\n")
    .map((f) => f.trim())
    .filter(Boolean)
    .sort();

  type RolesRoute = { route: string; roles: string[]; guards: unknown[] };

  const rolesRoutes: RolesRoute[] = [];
  for (const file of controllerFiles) {
    const mod = require(path.join(srcDir, file));
    for (const exported of Object.values(mod)) {
      if (typeof exported !== "function") continue;
      const controller = exported as new (...args: unknown[]) => unknown;
      if (Reflect.getMetadata(PATH_METADATA, controller) === undefined) continue;
      const classRoles: string[] | undefined = Reflect.getMetadata(ROLES_KEY, controller);
      const classGuards: unknown[] = Reflect.getMetadata(GUARDS_METADATA, controller) ?? [];
      for (const name of Object.getOwnPropertyNames(controller.prototype)) {
        if (name === "constructor") continue;
        const handler = Object.getOwnPropertyDescriptor(controller.prototype, name)?.value;
        if (typeof handler !== "function") continue;
        if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
        const roles: string[] | undefined =
          Reflect.getMetadata(ROLES_KEY, handler) ?? classRoles;
        if (!roles || roles.length === 0) continue;
        rolesRoutes.push({
          route: `${file}#${controller.name}.${name}`,
          roles,
          guards: [...classGuards, ...(Reflect.getMetadata(GUARDS_METADATA, handler) ?? [])],
        });
      }
    }
  }

  it("discovers @Roles routes across the controllers", () => {
    expect(controllerFiles.length).toBeGreaterThan(0);
    expect(rolesRoutes.length).toBeGreaterThan(0);
  });

  it("every @Roles route uses AuthGuard('jwt')", () => {
    const offenders = rolesRoutes
      .filter((r) => !r.guards.includes(JwtAuthGuard))
      .map((r) => r.route);
    expect(offenders).toEqual([]);
  });
});
