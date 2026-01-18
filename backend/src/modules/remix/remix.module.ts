import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { RemixController } from "./remix.controller";
import { RemixService } from "./remix.service";

@Module({
  controllers: [RemixController],
  providers: [EventBus, RemixService],
})
export class RemixModule {}
