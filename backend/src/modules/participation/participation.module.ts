import { Global, Module } from "@nestjs/common";
import { ParticipationController } from "./participation.controller";
import { ParticipationService } from "./participation.service";

/** #2666: global so ingestion can refuse uploads before acceptance. */
@Global()
@Module({
  controllers: [ParticipationController],
  providers: [ParticipationService],
  exports: [ParticipationService],
})
export class ParticipationModule {}
