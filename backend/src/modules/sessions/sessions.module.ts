import { Module } from "@nestjs/common";
import { IdentityModule } from "../identity/identity.module";
import { AgentsModule } from "../agents/agents.module";
import { SharedModule } from "../shared/shared.module";
import { SessionsController } from "./sessions.controller";
import { SessionsService } from "./sessions.service";
import {
  PLAYBACK_INTENT_CATALOG_RESOLVER,
  PlaybackIntentsService,
  PrismaPlaybackIntentCatalogResolver,
} from "./playback_intents.service";

@Module({
  imports: [SharedModule, IdentityModule, AgentsModule],
  controllers: [SessionsController],
  providers: [
    SessionsService,
    PrismaPlaybackIntentCatalogResolver,
    PlaybackIntentsService,
    {
      provide: PLAYBACK_INTENT_CATALOG_RESOLVER,
      useExisting: PrismaPlaybackIntentCatalogResolver,
    },
  ],
})
export class SessionsModule {}
