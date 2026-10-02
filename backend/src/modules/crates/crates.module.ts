import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { RecommendationsModule } from "../recommendations/recommendations.module";
import { CrateEntitlementsService } from "./crate-entitlements";
import { CRATE_REQUEST_PARSER } from "./crate_request_parser";
import { createCrateRequestParser } from "./model_crate_request_parser";
import { CratesController } from "./crates.controller";
import { CratesService } from "./crates.service";

/**
 * Crate Digger (#1962, docs/rfc/taste-engine.md §5.1-5.2).
 *
 * RecommendationsModule provides the shared ranker, the verified-human policy
 * lookup and the taste policy; AgentsModule provides the shared taste-profile
 * resolver. Nothing imports this module, so it adds no import cycle.
 */
@Module({
  imports: [RecommendationsModule, AgentsModule],
  controllers: [CratesController],
  providers: [
    CratesService,
    CrateEntitlementsService,
    // Deterministic by default; model-assisted only when
    // CRATE_REQUEST_PARSER_STRATEGY=model-assisted.
    { provide: CRATE_REQUEST_PARSER, useFactory: () => createCrateRequestParser() },
  ],
  exports: [CratesService, CrateEntitlementsService],
})
export class CratesModule {}
