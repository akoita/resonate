import { BadRequestException, Body, Controller, Get, Param, Patch, Post, Req, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ManagementService } from "./management.service";

@Controller("management")
@UseGuards(AuthGuard("jwt"))
export class ManagementController {
  constructor(private readonly managementService: ManagementService) {}

  @Get("me")
  getMe(@Req() req: any) {
    return this.managementService.getMe(req.user.userId);
  }

  @Get("artists/:id/access")
  getArtistAccess(@Req() req: any, @Param("id") artistId: string) {
    return this.managementService.getArtistAccess(req.user.userId, artistId);
  }

  @Get("releases/:id/access")
  getReleaseAccess(@Req() req: any, @Param("id") releaseId: string) {
    return this.managementService.getReleaseAccess(req.user.userId, releaseId);
  }

  @Post("grants")
  createGrant(@Req() req: any, @Body() body: Parameters<ManagementService["createGrant"]>[1]) {
    return this.managementService.createGrant(req.user.userId, body);
  }

  @Patch("grants/:id")
  updateGrant(
    @Req() req: any,
    @Param("id") grantId: string,
    @Body() body: unknown,
  ) {
    if (body === null || typeof body !== "object" || Array.isArray(body)) {
      throw new BadRequestException("Grant update body must be an object");
    }
    return this.managementService.updateGrant(
      req.user.userId,
      grantId,
      body as Parameters<ManagementService["updateGrant"]>[2],
    );
  }

  @Post("grants/:id/accept")
  acceptGrant(@Req() req: any, @Param("id") grantId: string) {
    return this.managementService.acceptGrant(req.user.userId, grantId);
  }

  @Post("grants/:id/decline")
  declineGrant(@Req() req: any, @Param("id") grantId: string) {
    return this.managementService.declineGrant(req.user.userId, grantId);
  }

  @Post("grants/:id/revoke")
  revokeGrant(@Req() req: any, @Param("id") grantId: string) {
    return this.managementService.revokeGrant(req.user.userId, grantId);
  }

  @Post("transfers")
  createTransfer(@Req() req: any, @Body() body: Parameters<ManagementService["createTransfer"]>[1]) {
    return this.managementService.createTransfer(req.user.userId, body);
  }

  @Post("transfers/:id/accept")
  acceptTransfer(@Req() req: any, @Param("id") transferId: string) {
    return this.managementService.acceptTransfer(req.user.userId, transferId);
  }

  @Post("transfers/:id/decline")
  declineTransfer(@Req() req: any, @Param("id") transferId: string) {
    return this.managementService.declineTransfer(req.user.userId, transferId);
  }

  @Post("transfers/:id/cancel")
  cancelTransfer(@Req() req: any, @Param("id") transferId: string) {
    return this.managementService.cancelTransfer(req.user.userId, transferId);
  }
}
