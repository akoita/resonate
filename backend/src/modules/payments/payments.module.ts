import { Module } from "@nestjs/common";
import { EventBus } from "../shared/event_bus";
import { PaymentsController } from "./payments.controller";
import { PaymentsService } from "./payments.service";

@Module({
  controllers: [PaymentsController],
  providers: [EventBus, PaymentsService],
})
export class PaymentsModule {}
