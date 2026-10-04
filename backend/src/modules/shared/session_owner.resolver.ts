import { Injectable } from "@nestjs/common";
import { prisma } from "../../db/prisma";

/**
 * Resolves the owning user of a DJ session. Used by the events gateway to
 * route agent events to the session owner's private realtime room.
 */
@Injectable()
export class SessionOwnerResolver {
    async resolveSessionOwner(sessionId: string): Promise<string | null> {
        if (typeof sessionId !== "string" || sessionId.length === 0) {
            return null;
        }
        const session = await prisma.session.findUnique({
            where: { id: sessionId },
            select: { userId: true },
        });
        return session?.userId ?? null;
    }
}
