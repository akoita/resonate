import { BadRequestException, Controller, Get, Param, Query } from "@nestjs/common";
import { isStemSource } from "../shared/stem-source";
import { StorefrontService } from "./storefront.service";

@Controller("api/storefront")
export class StorefrontController {
  constructor(private readonly storefrontService: StorefrontService) {}

  @Get("stems")
  searchStems(
    @Query("q") q?: string,
    @Query("stemType") stemType?: string,
    @Query("hasIpnft") hasIpnft?: string,
    @Query("source") source?: string,
    @Query("limit") limit?: string,
  ) {
    const parsedLimit = limit ? Number(limit) : undefined;
    if (source !== undefined && !isStemSource(source)) {
      throw new BadRequestException("source must be official or separated");
    }

    return this.storefrontService.searchStems({
      q,
      stemType,
      hasIpnft:
        hasIpnft === undefined ? undefined : hasIpnft.toLowerCase() === "true",
      source,
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
