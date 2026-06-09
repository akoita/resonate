import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { RemixController } from "./remix.controller";
import { RemixService } from "./remix.service";
import { RemixEligibilityService } from "./remix-eligibility.service";
import { RemixProjectService } from "./remix-project.service";

@Module({
  imports: [SharedModule],
  controllers: [RemixController],
  providers: [RemixService, RemixEligibilityService, RemixProjectService],
  exports: [RemixEligibilityService, RemixProjectService],
})
export class RemixModule {}
