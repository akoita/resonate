import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";

@Injectable()
export class ArtistService {
    async getProfile(userId: string) {
        return prisma.artist.findUnique({
            where: { userId },
        });
    }

    async createProfile(userId: string, data: { displayName: string; payoutAddress: string }) {
        const existing = await this.getProfile(userId);
        if (existing) {
            throw new BadRequestException("Artist profile already exists for this user");
        }

        return prisma.artist.create({
            data: {
                userId,
                displayName: data.displayName,
                payoutAddress: data.payoutAddress,
            },
        });
    }
}
