import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

export const ARTIST_REMIX_CONSENTS = ["allowed", "disabled"] as const;
export type ArtistRemixConsent = (typeof ARTIST_REMIX_CONSENTS)[number];

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
