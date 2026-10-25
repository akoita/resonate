import { Module } from "@nestjs/common";
import {
  SCENE_SCOUT_SOURCE,
  SceneScoutEntitlementsService,
  SceneScoutService,
} from "./scene_scout.service";
import { EntitlementsModule } from "../entitlements/entitlements.module";
import { UNMET_DEMAND_SOURCE } from "./unmet_demand.contracts";
import { UnmetDemandService } from "./unmet_demand.service";

@Module({
  imports: [EntitlementsModule],
  providers: [
    SceneScoutService,
    UnmetDemandService,
    SceneScoutEntitlementsService,
    { provide: SCENE_SCOUT_SOURCE, useExisting: SceneScoutService },
    { provide: UNMET_DEMAND_SOURCE, useExisting: UnmetDemandService },
  ],
  exports: [
    SceneScoutService,
    SceneScoutEntitlementsService,
    SCENE_SCOUT_SOURCE,
    UnmetDemandService,
    UNMET_DEMAND_SOURCE,
  ],
})
export class SceneScoutModule {}
