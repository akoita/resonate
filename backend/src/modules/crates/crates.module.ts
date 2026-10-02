import { Module } from "@nestjs/common";
import { AgentsModule } from "../agents/agents.module";
import { NotificationModule } from "../notifications/notification.module";
import { RecommendationsModule } from "../recommendations/recommendations.module";
import { CrateEntitlementsService } from "./crate-entitlements";
import { CRATE_MARKETPLACE_READER, createViemMarketplaceReader } from "./crate_marketplace_reader";
import { CrateExportService } from "./crate_export.service";
import { CrateWatchService } from "./crate_watch.service";
import { CrateQuoteService } from "./crate_quote.service";
import { CRATE_REQUEST_PARSER } from "./crate_request_parser";
import { createCrateRequestParser } from "./model_crate_request_parser";
import { CratesController } from "./crates.controller";
import { CratesService } from "./crates.service";

/**
 * Crate Digger (#1962, docs/rfc/taste-engine.md §5.1-5.2).
 *
 * RecommendationsModule provides the shared ranker, the verified-human policy
 * lookup and the taste policy; AgentsModule provides the shared taste-profile
 * resolver and the stem quality service the quote settlement validates with.
 * NotificationModule delivers the watch-match notification (#1967).
 * Nothing imports this module, so it adds no import cycle.
 */
@Module({
  imports: [RecommendationsModule, AgentsModule, NotificationModule],
  controllers: [CratesController],
  providers: [
    CratesService,
    CrateQuoteService,
    CrateExportService,
    // Watching (#1967): evaluates newly playable tracks against watching crates.
    CrateWatchService,
    CrateEntitlementsService,
    // The chain behind quotes and settlement; the indexer's RPC_URL and
    // MARKETPLACE_ADDRESS, so no new variable (#1964).
    { provide: CRATE_MARKETPLACE_READER, useFactory: () => createViemMarketplaceReader() },
    // Deterministic by default; model-assisted only when
    // CRATE_REQUEST_PARSER_STRATEGY=model-assisted.
    { provide: CRATE_REQUEST_PARSER, useFactory: () => createCrateRequestParser() },
  ],
  exports: [CratesService, CrateQuoteService, CrateEntitlementsService],
})
export class CratesModule {}
