import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { RemixController } from "./remix.controller";
import { RemixService } from "./remix.service";
import { RemixEligibilityService } from "./remix-eligibility.service";
import { RemixProjectService } from "./remix-project.service";
import {
  REMIX_GENERATION_PROVIDER,
  StubRemixGenerationProvider,
} from "./remix-generation.provider";

@Module({
  imports: [SharedModule],
  controllers: [RemixController],
  providers: [
    RemixService,
    RemixEligibilityService,
    RemixProjectService,
    // Provider boundary (#896): swap this binding to move Remix Studio onto
    // Lyria, audio-conditioned models, or DSP/local tools without touching
    // the project service.
    { provide: REMIX_GENERATION_PROVIDER, useClass: StubRemixGenerationProvider },
  ],
  exports: [RemixEligibilityService, RemixProjectService],
})
export class RemixModule {}
