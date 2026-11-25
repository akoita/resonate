import { Controller, Get, Query } from "@nestjs/common";
import { Throttle } from "@nestjs/throttler";
import { seconds } from "../shared/rate_limits";
import { SearchService } from "./search.service";

/**
 * Top-bar search (#2671). Public: it returns only what any visitor can
 * already open. The web field debounces; the rate limit bounds the rest.
 */
@Controller("search")
export class SearchController {
  constructor(private readonly searchService: SearchService) {}

  @Throttle({ default: { limit: 60, ttl: seconds(60) } })
  @Get()
  search(@Query("q") q?: string) {
    return this.searchService.search(q);
  }
}
