import { Module } from "@nestjs/common";
import { SharedModule } from "../shared/shared.module";
import { RemixController } from "./remix.controller";
import { RemixService } from "./remix.service";

@Module({
  imports: [SharedModule],
  controllers: [RemixController],
  providers: [RemixService],
})
export class RemixModule {}
