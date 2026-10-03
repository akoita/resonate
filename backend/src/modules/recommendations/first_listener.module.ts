import { Module } from "@nestjs/common";
import { FirstListenerDiscoveryService } from "./first_listener_discovery.service";
import { FirstListenerReceptionService } from "./first_listener_reception.service";

@Module({
  providers: [FirstListenerDiscoveryService, FirstListenerReceptionService],
  exports: [FirstListenerDiscoveryService, FirstListenerReceptionService],
})
export class FirstListenerModule {}
