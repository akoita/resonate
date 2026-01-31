import { BadRequestException, Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";

@Injectable()
export class ArtistService {
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
}
