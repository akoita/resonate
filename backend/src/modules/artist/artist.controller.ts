import {
    Body,
    Controller,
    Get,
    HttpCode,
    HttpStatus,
    Patch,
    Post,
    Query,
    Request,
    UseGuards,
    Param,
    NotFoundException,
    Optional,
    ServiceUnavailableException,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { Throttle } from "@nestjs/throttler";
import { Roles } from "../auth/roles.decorator";
import { RolesGuard } from "../auth/roles.guard";
import { hours } from "../shared/rate_limits";
import { ArtistService } from "./artist.service";
import { ArtistEnrichmentService } from "./artist-enrichment.service";

const ARTIST_ENRICHMENT_THROTTLE = {
    default: {
        limit: 10,
        ttl: hours(1),
        // The global throttler runs before the route JWT guard populates req.user.
        getTracker: (req: Record<string, any>) => req.ip,
    },
} as const;

@Controller("artists")
export class ArtistController {
    constructor(
        private readonly artistService: ArtistService,
        @Optional() private readonly artistEnrichmentService?: ArtistEnrichmentService,
    ) { }

    @UseGuards(AuthGuard("jwt"))
    @Get("me")
    getMe(@Request() req: any) {
        return this.artistService.getProfile(req.user.userId);
    }

    // Declared before `@Get(":id")` so "search" is matched as a literal route
    // rather than being captured as an artist id param.
    @UseGuards(AuthGuard("jwt"))
    @Get("search")
    search(@Query("q") q?: string, @Query("limit") limit?: string) {
        const parsedLimit = limit ? Number.parseInt(limit, 10) : undefined;
        return this.artistService.searchByName(
            q ?? "",
            parsedLimit !== undefined && Number.isFinite(parsedLimit) ? parsedLimit : undefined,
        );
    }

    @UseGuards(AuthGuard("jwt"))
    @Get("claims/me")
    getMyClaims(@Request() req: any) {
        return this.artistService.getMyClaims(req.user.userId);
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

    @UseGuards(AuthGuard("jwt"))
    @Patch(":id")
    updateProfile(
        @Request() req: any,
        @Param("id") id: string,
        @Body()
        body: {
            imageUrl?: unknown;
            summary?: unknown;
            socialLinks?: unknown;
            website?: unknown;
        },
    ) {
        return this.artistService.updateProfile(req.user.userId, id, body);
    }

    @Throttle(ARTIST_ENRICHMENT_THROTTLE)
    @UseGuards(AuthGuard("jwt"))
    @Get(":id/enrichment/candidates")
    async getEnrichmentCandidates(@Request() req: any, @Param("id") id: string) {
        const artist = await this.artistService.authorizeProfileEdit(req.user.userId, id);
        return this.requireArtistEnrichmentService().findCandidates(artist.displayName);
    }

    @Throttle(ARTIST_ENRICHMENT_THROTTLE)
    @UseGuards(AuthGuard("jwt"))
    @HttpCode(HttpStatus.OK)
    @Post(":id/enrichment/suggestions")
    async getEnrichmentSuggestions(
        @Request() req: any,
        @Param("id") id: string,
        @Body() body: { candidateId?: unknown },
    ) {
        await this.artistService.authorizeProfileEdit(req.user.userId, id);
        return this.requireArtistEnrichmentService().buildSuggestions(body?.candidateId);
    }

    private requireArtistEnrichmentService(): ArtistEnrichmentService {
        if (!this.artistEnrichmentService) {
            throw new ServiceUnavailableException("Artist enrichment is unavailable");
        }
        return this.artistEnrichmentService;
    }

    @Throttle({
        default: {
            limit: 5,
            ttl: hours(1),
            getTracker: (req: Record<string, any>) => req.user?.userId ?? req.ip,
        },
    })
    @UseGuards(AuthGuard("jwt"))
    @Post(":id/claims")
    submitClaim(
        @Request() req: any,
        @Param("id") id: string,
        @Body() body: { evidence?: unknown },
    ) {
        return this.artistService.submitClaim(req.user.userId, id, body.evidence);
    }

    @UseGuards(AuthGuard("jwt"))
    @Get(":id/claims/me")
    getMyClaim(@Request() req: any, @Param("id") id: string) {
        return this.artistService.getMyClaim(req.user.userId, id);
    }

    @UseGuards(AuthGuard("jwt"), RolesGuard)
    @Roles("admin", "operator")
    @Get("claims/pending")
    listPendingClaims(@Request() req: any) {
        return this.artistService.listPendingClaims(req.user.role);
    }

    @UseGuards(AuthGuard("jwt"), RolesGuard)
    @Roles("admin", "operator")
    @Patch("claims/:claimId")
    reviewClaim(
        @Request() req: any,
        @Param("claimId") claimId: string,
        @Body() body: { decision?: unknown; note?: unknown },
    ) {
        return this.artistService.reviewClaim(
            req.user.userId,
            req.user.role,
            claimId,
            body.decision,
            body.note,
        );
    }

    @Get(":id")
    async getById(@Param("id") id: string) {
        const artist = await this.artistService.findById(id);
        if (!artist) {
            throw new NotFoundException(`Artist not found`);
        }
        return {
            id: artist.id,
            displayName: artist.displayName,
            profileType: artist.profileType,
            imageUrl: artist.imageUrl,
            summary: artist.summary,
            socialLinks: artist.socialLinks,
            website: artist.website,
            remixConsent: artist.remixConsent,
            createdAt: artist.createdAt,
            updatedAt: artist.updatedAt,
        };
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
