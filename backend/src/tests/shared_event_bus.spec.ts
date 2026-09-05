import { MODULE_METADATA } from "@nestjs/common/constants";
import { DiscoveryRankingService } from "../modules/recommendations/discovery-ranking.service";
import { ConfigService } from "@nestjs/config";
import { EventBus } from "../modules/shared/event_bus";
import { SharedModule } from "../modules/shared/shared.module";
import { SessionsModule } from "../modules/sessions/sessions.module";
import { SessionsService } from "../modules/sessions/sessions.service";
import { PaymentsModule } from "../modules/payments/payments.module";
import { PaymentsService } from "../modules/payments/payments.service";
import { RecommendationsModule } from "../modules/recommendations/recommendations.module";
import { RecommendationsService } from "../modules/recommendations/recommendations.service";
import { RemixModule } from "../modules/remix/remix.module";
import { RemixService } from "../modules/remix/remix.service";
import { CurationModule } from "../modules/curation/curation.module";
import { CurationService } from "../modules/curation/curation.service";
import { AgentsModule } from "../modules/agents/agents.module";
import { AgentWorkerModule } from "../modules/agents/agent_worker.module";
import { AGENT_RUNTIME_CORE_PROVIDERS } from "../modules/agents/agent_runtime.providers";
import { AgentPolicyService } from "../modules/agents/agent_policy.service";
import { AgentRunnerService } from "../modules/agents/agent_runner.service";
import { ResonateEvent } from "../events/event_types";
import { prisma } from "../db/prisma";

jest.mock("../db/prisma", () => ({
  prisma: {
    session: {
      create: jest.fn(),
    },
    // #1448: preferences are durable now; this unit spec only needs the
    // upsert to resolve so the preferences_updated event fires.
    recommendationProfile: {
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn().mockResolvedValue({}),
    },
  },
}));

describe("shared EventBus wiring", () => {
  it("uses SharedModule instead of module-local EventBus providers", () => {
    for (const moduleType of [
      SessionsModule,
      PaymentsModule,
      RecommendationsModule,
      RemixModule,
      CurationModule,
      AgentsModule,
      AgentWorkerModule,
    ]) {
      const imports = Reflect.getMetadata(MODULE_METADATA.IMPORTS, moduleType) ?? [];
      const providers = Reflect.getMetadata(MODULE_METADATA.PROVIDERS, moduleType) ?? [];

      expect(imports).toContain(SharedModule);
      expect(providers).not.toContain(EventBus);
    }

    expect(AGENT_RUNTIME_CORE_PROVIDERS).not.toContain(EventBus);
  });

  it("lets a single subscriber observe high-value domain events across modules", async () => {
    const eventBus = new EventBus();
    const observed: ResonateEvent[] = [];
    const watchedEvents = [
      "session.started",
      "payment.initiated",
      "recommendation.preferences_updated",
      "remix.created",
      "curator.staked",
      "agent.evaluated",
    ];
    const subscriptions = watchedEvents.map((eventName) =>
      eventBus.subscribe(eventName as ResonateEvent["eventName"], (event) => {
        observed.push(event);
      }),
    );

    try {
      (prisma.session.create as jest.Mock).mockResolvedValue({
        id: "session_shared_bus",
        userId: "user_shared_bus",
        budgetCapUsd: 10,
        spentUsd: 0,
      });

      const sessions = new SessionsService(
        { setBudget: jest.fn().mockResolvedValue({}) } as any,
        eventBus,
        {} as any,
        {} as any,
      );
      await sessions.startSession({
        userId: "user_shared_bus",
        budgetCapUsd: 10,
        preferences: { mood: "bright" },
      });

      const payments = new PaymentsService(eventBus, new ConfigService());
      payments.initiatePayment({
        sessionId: "session_shared_bus",
        trackId: "track_shared_bus",
        amountUsd: 1,
      });

      const recommendations = new RecommendationsService(eventBus, new DiscoveryRankingService());
      await recommendations.setPreferences("user_shared_bus", { genres: ["ambient"] });

      const remix = new RemixService(eventBus);
      remix.createRemix({
        creatorId: "user_shared_bus",
        sourceTrackId: "track_shared_bus",
        stemIds: ["stem_1"],
        title: "Shared Bus Remix",
      });

      const curation = new CurationService(eventBus, { log: jest.fn() } as any);
      curation.stake({ curatorId: "curator_shared_bus", amountUsd: 5 });

      const runner = new AgentRunnerService(new AgentPolicyService(), eventBus);
      runner.run({
        sessionId: "session_shared_bus",
        userId: "user_shared_bus",
        trackId: "track_shared_bus",
        recentTrackIds: [],
        budgetRemainingUsd: 10,
        preferences: { licenseType: "personal" },
      });

      expect(observed.map((event) => event.eventName)).toEqual(watchedEvents);
    } finally {
      subscriptions.forEach((subscription) => subscription.unsubscribe());
      eventBus.destroy();
    }
  });
});
