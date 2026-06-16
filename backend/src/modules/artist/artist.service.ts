import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

export const ARTIST_REMIX_CONSENTS = ["allowed", "disabled"] as const;
export type ArtistRemixConsent = (typeof ARTIST_REMIX_CONSENTS)[number];

export type ArtistSearchResult = {
    id: string;
    displayName: string;
    imageUrl: string | null;
    profileType: string | null;
    claimStatus: string | null;
};

// When two profiles share a name (e.g. a managed profile and an auto-created
// unclaimed public profile), keep the one most useful to credit against.
function artistCandidateScore(artist: ArtistSearchResult): number {
    let score = 0;
    if (artist.claimStatus === "claimed") score += 4;
    if (artist.profileType === "public_artist") score += 2;
    if (artist.imageUrl) score += 1;
    return score;
}

function artistRelevanceScore(artist: ArtistSearchResult, lowerQuery: string): number {
    const name = artist.displayName.trim().toLowerCase();
    let score = artistCandidateScore(artist);
    if (name === lowerQuery) score += 100;
    else if (name.startsWith(lowerQuery)) score += 40;
    return score;
}

function normalizeRemixConsent(input: unknown): ArtistRemixConsent {
    if (typeof input !== "string") {
        throw new BadRequestException("remixConsent must be allowed or disabled");
    }
    const normalized = input.trim().toLowerCase();
    if (!ARTIST_REMIX_CONSENTS.includes(normalized as ArtistRemixConsent)) {
        throw new BadRequestException("remixConsent must be allowed or disabled");
    }
    return normalized as ArtistRemixConsent;
}

@Injectable()
export class ArtistService {
    // Required injection (#1170 review): a defaulted `new EventBus()` would
    // silently split the bus if module wiring ever regressed — consent events
    // would publish where no analytics bridge subscribes.
    constructor(private readonly eventBus: EventBus) {}

    async getProfile(userId: string) {
        return prisma.artist.findUnique({
            where: { userId },
        });
    }

    async findById(id: string) {
        return prisma.artist.findUnique({
            where: { id },
        });
    }

    /**
     * Typeahead search used by the upload/publish studio so artists can pick an
     * existing profile instead of accidentally minting a duplicate via a typo or
     * a casing/spacing difference. Catalog credit resolution links names to
     * profiles by exact (case-insensitive) displayName, so surfacing the canonical
     * spelling here is what actually prevents the duplicate.
     *
     * Results are deduped by normalized name (a manager profile and an unclaimed
     * public profile can share a name) and ranked so the most reusable, highest
     * signal match shows first: exact match > prefix match > claimed > has art.
     */
    async searchByName(query: string, limit = 8): Promise<ArtistSearchResult[]> {
        const normalized = (query ?? "").trim();
        if (normalized.length < 1) {
            return [];
        }
        const take = Math.min(Math.max(Math.trunc(limit) || 8, 1), 25);

        const matches = await prisma.artist.findMany({
            where: { displayName: { contains: normalized, mode: "insensitive" } },
            // Over-fetch so JS-side ranking/dedupe still has enough to fill `take`.
            take: take * 4,
            select: {
                id: true,
                displayName: true,
                imageUrl: true,
                profileType: true,
                claimStatus: true,
            },
        });

        const lowerQuery = normalized.toLowerCase();
        const byName = new Map<string, ArtistSearchResult>();
        for (const artist of matches) {
            const key = artist.displayName.trim().toLowerCase();
            const existing = byName.get(key);
            if (!existing || artistCandidateScore(artist) > artistCandidateScore(existing)) {
                byName.set(key, artist);
            }
        }

        return Array.from(byName.values())
            .sort((a, b) => artistRelevanceScore(b, lowerQuery) - artistRelevanceScore(a, lowerQuery)
                || a.displayName.localeCompare(b.displayName))
            .slice(0, take);
    }

    async createProfile(userId: string, data: { displayName: string; payoutAddress: string }) {
        const existing = await this.getProfile(userId);
        if (existing) {
            throw new BadRequestException("Artist profile already exists for this user");
        }

        // Ensure User record exists (wallet-based auth may not create one)
        await prisma.user.upsert({
            where: { id: userId },
            update: {},
            create: {
                id: userId,
                email: `${userId}@wallet.resonate`, // Placeholder for wallet-based users
            },
        });

        return prisma.artist.create({
            data: {
                userId,
                displayName: data.displayName,
                payoutAddress: data.payoutAddress,
            },
        });
    }

    async getSettings(userId: string, artistId: string) {
        const artist = await this.requireOwnedArtist(userId, artistId);
        return artistSettingsDto(artist);
    }

    async updateSettings(userId: string, artistId: string, input: { remixConsent?: unknown }) {
        const artist = await this.requireOwnedArtist(userId, artistId);
        if (input.remixConsent === undefined) {
            return artistSettingsDto(artist);
        }
        const previous = normalizeRemixConsent(artist.remixConsent);
        const next = normalizeRemixConsent(input.remixConsent);
        if (previous === next) {
            return artistSettingsDto(artist);
        }
        const updated = await prisma.artist.update({
            where: { id: artist.id },
            data: { remixConsent: next },
        });
        this.eventBus.publish({
            eventName: "artist.remix_consent_updated",
            eventVersion: 1,
            occurredAt: new Date().toISOString(),
            artistId: updated.id,
            userId,
            previous,
            next,
        });
        return artistSettingsDto(updated);
    }

    private async requireOwnedArtist(userId: string, artistId: string) {
        const artist = await prisma.artist.findUnique({ where: { userId } });
        if (!artist) {
            throw new NotFoundException("Artist profile not found");
        }
        if (artist.id !== artistId) {
            throw new ForbiddenException("You do not manage this artist profile");
        }
        return artist;
    }
}

function artistSettingsDto(artist: { id: string; remixConsent: string; updatedAt: Date }) {
    return {
        schemaVersion: "artist-settings/v1",
        artistId: artist.id,
        remixConsent: normalizeRemixConsent(artist.remixConsent),
        updatedAt: artist.updatedAt.toISOString(),
    };
}
