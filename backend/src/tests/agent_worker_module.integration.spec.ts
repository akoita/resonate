import "reflect-metadata";
import { Test, TestingModule } from "@nestjs/testing";
import { AgentWorkerModule } from "../modules/agents/agent_worker.module";
import { AgentRuntimeExecutorService } from "../modules/agents/agent_runtime.executor.service";
import { AgentRuntimePolicyService } from "../modules/agents/agent_runtime.policy.service";
import { AgentRuntimeService } from "../modules/agents/agent_runtime.service";
import { AgentSelectorService } from "../modules/agents/agent_selector.service";
import { AgentRuntimeWorkerController } from "../modules/agents/agent_runtime_worker.controller";
import { CommunityCohortService } from "../modules/community/community_cohort.service";
import { DiscoveryPolicyContextService } from "../modules/recommendations/discovery-policy-context.service";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";
import { TasteMemoryService } from "../modules/recommendations/taste_memory.service";

/**
 * #1456 WS-9: the standalone agent runtime worker (`agent-worker.ts`) must be
 * able to resolve the shared ranking / policy stack. Compiling the real
 * `AgentWorkerModule` (against the Testcontainers Redis for BullMQ) fails with a
 * Nest DI error if `AgentSelectorService` or `AgentRuntimePolicyService` lose
 * one of those dependencies.
 *
 * Policy application stays single-sourced: the backend's
 * `AgentRuntimeService.run` polices remote LLM picks, and the worker controller
 * calls the executor directly, so nothing is policed twice.
 */
describe("AgentWorkerModule wiring (#1456)", () => {
  const originalEnv = { ...process.env };
  let moduleRef: TestingModule;

  beforeAll(async () => {
    // EncryptionModule (via CatalogModule) derives its key from this at init.
    process.env.JWT_SECRET ||= "agent-worker-module-test-only";
    moduleRef = await Test.createTestingModule({
      imports: [AgentWorkerModule],
    }).compile();
  });

  afterAll(async () => {
    await moduleRef?.close();
    process.env = originalEnv;
  });

  it("resolves the runtime policy step with its ranking and context dependencies", () => {
    const policy = moduleRef.get(AgentRuntimePolicyService) as any;

    expect(policy.ranking).toBeInstanceOf(DiscoveryRankingService);
    expect(policy.policyContext).toBeInstanceOf(DiscoveryPolicyContextService);
    expect(policy.tasteMemory).toBeInstanceOf(TasteMemoryService);
    expect(policy.recommendations).toBeInstanceOf(RecommendationsService);
    expect(policy.cohorts).toBeInstanceOf(CommunityCohortService);
    expect(policy.learning).toBeDefined();
  });

  it("wires the same policy service into the worker's AgentRuntimeService", () => {
    const runtime = moduleRef.get(AgentRuntimeService) as any;
    expect(runtime.policy).toBe(moduleRef.get(AgentRuntimePolicyService));
  });

  it("resolves the deterministic selector used by the worker's orchestrator fallback", () => {
    const selector = moduleRef.get(AgentSelectorService) as any;
    expect(selector.rankingService).toBeInstanceOf(DiscoveryRankingService);
  });

  it("serves the execute route from the executor, not from a second policy pass", () => {
    const controller = moduleRef.get(AgentRuntimeWorkerController) as any;
    expect(controller.executor).toBe(moduleRef.get(AgentRuntimeExecutorService));
    expect(controller.policy).toBeUndefined();
  });
});
