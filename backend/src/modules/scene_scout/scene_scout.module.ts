import { Module } from "@nestjs/common";
import {
  SCENE_SCOUT_SOURCE,
  SceneScoutEntitlementsService,
  SceneScoutService,
} from "./scene_scout.service";

@Module({
  providers: [
    SceneScoutService,
    SceneScoutEntitlementsService,
    { provide: SCENE_SCOUT_SOURCE, useExisting: SceneScoutService },
  ],
  exports: [SceneScoutService, SceneScoutEntitlementsService, SCENE_SCOUT_SOURCE],
})
export class SceneScoutModule {}
