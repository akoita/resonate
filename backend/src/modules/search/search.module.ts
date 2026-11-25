import { Module } from "@nestjs/common";
import { PlaylistModule } from "../playlist/playlist.module";
import { SearchController } from "./search.controller";
import { SearchService } from "./search.service";

@Module({
  imports: [PlaylistModule],
  controllers: [SearchController],
  providers: [SearchService],
})
export class SearchModule {}
