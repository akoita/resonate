import { Body, Controller, Delete, Get, HttpCode, Param, Put, Request, UseGuards } from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { FollowArtistDto } from "./artist_follow.dto";
import { ArtistFollowService } from "./artist_follow.service";

type AuthenticatedRequest = { user: { userId: string } };

/**
 * Follow state for the signed-in listener (#1968). Every route is scoped to
 * the JWT subject; no user id is accepted from the path, query or body, and
 * there is deliberately no endpoint that lists or counts an artist's followers.
 */
@Controller("artists")
@UseGuards(AuthGuard("jwt"))
export class ArtistFollowController {
  constructor(private readonly followService: ArtistFollowService) {}

  @Get(":artistId/follow")
  getStatus(@Request() req: AuthenticatedRequest, @Param("artistId") artistId: string) {
    return this.followService.getStatus(req.user.userId, artistId);
  }

  @Put(":artistId/follow")
  @HttpCode(200)
  follow(
    @Request() req: AuthenticatedRequest,
    @Param("artistId") artistId: string,
    @Body() body: FollowArtistDto,
  ) {
    return this.followService.follow(req.user.userId, artistId, body ?? {});
  }

  @Delete(":artistId/follow")
  @HttpCode(200)
  unfollow(@Request() req: AuthenticatedRequest, @Param("artistId") artistId: string) {
    return this.followService.unfollow(req.user.userId, artistId);
  }
}
