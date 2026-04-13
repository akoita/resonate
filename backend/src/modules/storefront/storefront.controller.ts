import { Controller, Get, Param, Query } from "@nestjs/common";
import { StorefrontService } from "./storefront.service";

@Controller("api/storefront")
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get("stems")
  searchStems(
    @Query("q") q?: string,
    @Query("stemType") stemType?: string,
    @Query("hasIpnft") hasIpnft?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;

    return this.storefrontService.searchStems({
      q,
      stemType,
      hasIpnft:
        hasIpnft === undefined ? undefined : hasIpnft.toLowerCase() === "true",
      limit:
        parsedLimit === undefined || Number.isNaN(parsedLimit)
          ? undefined
          : parsedLimit,
    });
  }

  @Get("stems/:stemId")
  getStemDetail(@Param("stemId") stemId: string) {
    return this.storefrontService.getStemDetail(stemId);
  }
}
