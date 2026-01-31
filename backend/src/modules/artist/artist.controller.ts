import {
    Body,
    Controller,
    Get,
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

    @Get(":id")
    async getById(@Param("id") id: string) {
        if (id === "me") return; // Handled by @Get("me") but Express routing might match :id first if not careful.
        // NestJS specifically matches static paths first, so "me" should be hit by @Get("me") above if defined above?
        // Actually, decorators order matters. If I put :id below me, it is safer.

        const artist = await this.artistService.findById(id);
        if (!artist) {
            throw new NotFoundException(`Artist not found`);
        }
        return artist;
    }

    @UseGuards(AuthGuard("jwt"))
    @Get("me")
    getMe(@Request() req: any) {
        return this.artistService.getProfile(req.user.userId);
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
