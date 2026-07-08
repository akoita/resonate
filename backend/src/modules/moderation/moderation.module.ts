import { Module } from "@nestjs/common";
import { PromptModerationService } from "./prompt-moderation.service";

/**
 * Cross-cutting content-moderation services (#1343). Currently the
 * prompt-safety screen for the self-hosted generation path; kept as its own
 * leaf module (no dependencies) so any generation surface can import it without
 * coupling.
 */
@Module({
  providers: [PromptModerationService],
  exports: [PromptModerationService],
})
export class ModerationModule {}
