import {
    Body,
    Controller,
    Get,
    Patch,
    Post,
    Request,
    UseGuards,
    Param,
    NotFoundException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { ArtistService } from "./artist.service";

@Controller("artists")
export class ArtistController {
    constructor(private readonly artistService: ArtistService) { }

    @UseGuards(AuthGuard("jwt"))
    @Get("me")
    getMe(@Request() req: any) {
        return this.artistService.getProfile(req.user.userId);
    }

    @UseGuards(AuthGuard("jwt"))
    @Get(":id/settings")
    getSettings(@Request() req: any, @Param("id") id: string) {
        return this.artistService.getSettings(req.user.userId, id);
    }

    @UseGuards(AuthGuard("jwt"))
    @Patch(":id/settings")
    updateSettings(
        @Request() req: any,
        @Param("id") id: string,
        @Body() body: { remixConsent?: unknown },
    ) {
        return this.artistService.updateSettings(req.user.userId, id, body);
    }

    @Get(":id")
    async getById(@Param("id") id: string) {
        const artist = await this.artistService.findById(id);
        if (!artist) {
            throw new NotFoundException(`Artist not found`);
        }
        return artist;
    }

    @UseGuards(AuthGuard("jwt"))
    @Post()
    create(
        @Request() req: any,
        @Body() body: { displayName: string; payoutAddress: string },
    ) {
        return this.artistService.createProfile(req.user.userId, body);
    }
}
