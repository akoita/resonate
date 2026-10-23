import { Module } from "@nestjs/common";
import { TrackDescriptorService } from "./track_descriptor.service";

/**
 * Track descriptors (#2240). One instance per process so the
 * `catalog.release_ready` subscription registers exactly once. `EventBus`
 * comes from the global `SharedModule`. Imported by `EmbeddingsModule`, which
 * awaits `ensureTracks` before it embeds a release.
 */
@Module({
  providers: [TrackDescriptorService],
  exports: [TrackDescriptorService],
})
export class DescriptorsModule {}
