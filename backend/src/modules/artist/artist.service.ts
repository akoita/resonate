import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { hasArtistManagementAccess } from "../management/management-access";
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

// Rank suggestions without collapsing distinct same-name identities.
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

// Canonical shape for `Artist.socialLinks` — each key is a full URL. Keys are
// intentionally an explicit allowlist rather than free-form so the frontend
// can render a fixed set of icons and so we never persist arbitrary keys.
export const ARTIST_SOCIAL_LINK_KEYS = [
    "x",
    "instagram",
    "tiktok",
    "youtube",
    "soundcloud",
] as const;
export type ArtistSocialLinkKey = (typeof ARTIST_SOCIAL_LINK_KEYS)[number];
export type ArtistSocialLinks = Partial<Record<ArtistSocialLinkKey, string>>;

const MAX_BIO_LENGTH = 2000;
const MAX_URL_LENGTH = 2048;
const MIN_ARTIST_CLAIM_EVIDENCE_LENGTH = 20;
const MAX_ARTIST_CLAIM_EVIDENCE_LENGTH = 4000;
const MAIN_ARTIST_CREDIT_ROLES = ["main", "primary"];
const AUTO_CLAIM_REJECTION_NOTE = "Another claim for this artist was approved.";
// Only http(s) URLs are ever persisted — this is the primary XSS/open-redirect
// guard for values that get rendered back as anchors/img src on the profile
// page (rejects `javascript:`, `data:`, `vbscript:`, bare `//host`, etc).
const ALLOWED_URL_SCHEMES = ["http:", "https:"];

export type UpdateArtistProfileInput = {
    imageUrl?: unknown;
    summary?: unknown;
    socialLinks?: unknown;
    website?: unknown;
};

export type ArtistClaimDecision = "approve" | "reject" | "revoke";

function normalizeArtistClaimEvidence(input: unknown): string {
    if (typeof input !== "string") {
        throw new BadRequestException("evidence must be a string");
    }
    const evidence = input.trim();
    const length = Array.from(evidence).length;
    if (length < MIN_ARTIST_CLAIM_EVIDENCE_LENGTH || length > MAX_ARTIST_CLAIM_EVIDENCE_LENGTH) {
        throw new BadRequestException(
            `evidence must be between ${MIN_ARTIST_CLAIM_EVIDENCE_LENGTH} and ${MAX_ARTIST_CLAIM_EVIDENCE_LENGTH} characters`,
        );
    }
    return evidence;
}

function normalizeArtistClaimDecision(input: unknown): ArtistClaimDecision {
    if (input !== "approve" && input !== "reject" && input !== "revoke") {
        throw new BadRequestException("decision must be approve, reject, or revoke");
    }
    return input;
}

function normalizeArtistClaimReviewNote(input: unknown): string | null {
    if (input === undefined || input === null) return null;
    if (typeof input !== "string") {
        throw new BadRequestException("note must be a string");
    }
    return input.trim() || null;
}

function assertArtistClaimOperator(role: unknown): void {
    if (role !== "admin" && role !== "operator") {
        throw new ForbiddenException("Artist claim review is restricted to operators");
    }
}

function isUniqueConstraintViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

/**
 * Validates and normalizes a single URL-like field. `undefined` means "field
 * not present in the request" (caller should treat as "leave unchanged").
 * `null` or an empty/whitespace string means "clear the field" and normalizes
 * to `null`. Anything else must parse as an absolute http(s) URL.
 */
function normalizeOptionalUrl(input: unknown, fieldName: string): string | null | undefined {
    if (input === undefined) {
        return undefined;
    }
    if (input === null) {
        return null;
    }
    if (typeof input !== "string") {
        throw new BadRequestException(`${fieldName} must be a string URL`);
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) {
        return null;
    }
    if (trimmed.length > MAX_URL_LENGTH) {
        throw new BadRequestException(`${fieldName} must be at most ${MAX_URL_LENGTH} characters`);
    }
    let parsed: URL;
    try {
        parsed = new URL(trimmed);
    } catch {
        throw new BadRequestException(`${fieldName} must be a valid absolute URL`);
    }
    if (!ALLOWED_URL_SCHEMES.includes(parsed.protocol)) {
        throw new BadRequestException(`${fieldName} must use http:// or https://`);
    }
    return parsed.toString();
}

function normalizeOptionalSummary(input: unknown): string | null | undefined {
    if (input === undefined) {
        return undefined;
    }
    if (input === null) {
        return null;
    }
    if (typeof input !== "string") {
        throw new BadRequestException("summary must be a string");
    }
    const trimmed = input.trim();
    if (trimmed.length === 0) {
        return null;
    }
    if (trimmed.length > MAX_BIO_LENGTH) {
        throw new BadRequestException(`summary must be at most ${MAX_BIO_LENGTH} characters`);
    }
    return trimmed;
}

function normalizeOptionalSocialLinks(input: unknown): ArtistSocialLinks | null | undefined {
    if (input === undefined) {
        return undefined;
    }
    if (input === null) {
        return null;
    }
    if (typeof input !== "object" || Array.isArray(input)) {
        throw new BadRequestException("socialLinks must be an object");
    }
    const record = input as Record<string, unknown>;
    const normalized: ArtistSocialLinks = {};
    for (const key of Object.keys(record)) {
        if (!ARTIST_SOCIAL_LINK_KEYS.includes(key as ArtistSocialLinkKey)) {
            throw new BadRequestException(`socialLinks.${key} is not a supported platform`);
        }
        const value = normalizeOptionalUrl(record[key], `socialLinks.${key}`);
        // Omit empty/absent keys from the persisted shape rather than storing
        // explicit nulls inside the JSON blob.
        if (value) {
            normalized[key as ArtistSocialLinkKey] = value;
        }
    }
    // An entirely empty object clears socialLinks back to null rather than
    // persisting `{}`.
    return Object.keys(normalized).length > 0 ? normalized : null;
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

    async submitClaim(userId: string, artistId: string, evidenceInput: unknown) {
        const evidence = normalizeArtistClaimEvidence(evidenceInput);
        try {
            return await prisma.$transaction(async (tx) => {
            // Serialize submissions from one claimant so the pending-claim cap
            // remains correct when several requests arrive at once.
            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "User" WHERE "id" = ${userId} FOR UPDATE`);
            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Artist" WHERE "id" = ${artistId} FOR UPDATE`);

            const artist = await tx.artist.findUnique({
                where: { id: artistId },
                select: {
                    id: true,
                    userId: true,
                    profileType: true,
                    claimStatus: true,
                    releaseCredits: {
                        where: {
                            role: { in: MAIN_ARTIST_CREDIT_ROLES },
                            identityStatus: { not: "ambiguous" },
                        },
                        select: { id: true },
                        take: 1,
                    },
                },
            });
            if (!artist) throw new NotFoundException("Artist not found");
            if (
                artist.userId !== null
                || artist.profileType !== "public_artist"
                || artist.claimStatus !== "unclaimed"
                || artist.releaseCredits.length === 0
            ) {
                throw new ConflictException("Artist profile is not eligible for a claim");
            }

            const existing = await tx.artistClaimRequest.findFirst({
                where: { artistId, claimantUserId: userId, status: "pending" },
                select: { id: true },
            });
            if (existing) throw new ConflictException("A pending claim already exists for this artist");

            const pendingClaimCount = await tx.artistClaimRequest.count({
                where: { claimantUserId: userId, status: "pending" },
            });
            if (pendingClaimCount >= 5) {
                throw new ConflictException("A claimant may have at most 5 pending artist claims");
            }

                return tx.artistClaimRequest.create({
                    data: { artistId, claimantUserId: userId, evidence },
                    select: {
                        id: true,
                        artistId: true,
                        status: true,
                        createdAt: true,
                        updatedAt: true,
                        reviewedAt: true,
                    },
                });
            });
        } catch (error) {
            if (isUniqueConstraintViolation(error)) {
                throw new ConflictException("A pending claim already exists for this artist");
            }
            throw error;
        }
    }

    async getMyClaim(userId: string, artistId: string) {
        return prisma.artistClaimRequest.findFirst({
            where: { artistId, claimantUserId: userId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
                id: true,
                artistId: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                reviewedAt: true,
            },
        });
    }

    async getMyClaims(userId: string) {
        const claims = await prisma.artistClaimRequest.findMany({
            where: { claimantUserId: userId },
            orderBy: [{ createdAt: "desc" }, { id: "desc" }],
            select: {
                artistId: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                reviewedAt: true,
                artist: {
                    select: { id: true, displayName: true, imageUrl: true },
                },
            },
        });

        // Claims are ordered newest first, so the first row for each exact
        // artist ID is that artist's latest claim. Names are not identities:
        // same-name profiles stay separate in this response.
        const latestByArtist = new Map<string, (typeof claims)[number]>();
        for (const claim of claims) {
            if (!latestByArtist.has(claim.artistId)) {
                latestByArtist.set(claim.artistId, claim);
            }
        }

        return Array.from(latestByArtist.values(), (claim) => ({
            status: claim.status,
            createdAt: claim.createdAt,
            updatedAt: claim.updatedAt,
            reviewedAt: claim.reviewedAt,
            artist: claim.artist,
        }));
    }

    async listPendingClaims(actorRole: unknown) {
        assertArtistClaimOperator(actorRole);
        return prisma.artistClaimRequest.findMany({
            where: { status: "pending" },
            orderBy: [{ createdAt: "asc" }, { id: "asc" }],
            select: {
                id: true,
                artistId: true,
                claimantUserId: true,
                evidence: true,
                status: true,
                createdAt: true,
                artist: { select: { id: true, displayName: true } },
            },
        });
    }

    async reviewClaim(
        reviewerUserId: string,
        reviewerRole: unknown,
        claimId: string,
        decisionInput: unknown,
        noteInput?: unknown,
    ) {
        assertArtistClaimOperator(reviewerRole);
        const decision = normalizeArtistClaimDecision(decisionInput);
        const reviewNote = normalizeArtistClaimReviewNote(noteInput);

        try {
            return await prisma.$transaction(async (tx) => {
            const initial = await tx.artistClaimRequest.findUnique({
                where: { id: claimId },
                select: { artistId: true },
            });
            if (!initial) throw new NotFoundException("Artist claim not found");

            await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "Artist" WHERE "id" = ${initial.artistId} FOR UPDATE`);
            const claim = await tx.artistClaimRequest.findUnique({
                where: { id: claimId },
                include: { artist: { select: { id: true, userId: true, profileType: true, claimStatus: true } } },
            });
            if (!claim) throw new NotFoundException("Artist claim not found");

            const now = new Date();
            if (decision === "revoke") {
                if (claim.status !== "approved") {
                    throw new ConflictException("Only an approved artist claim can be revoked");
                }
                const updated = await tx.artistClaimRequest.updateMany({
                    where: { id: claimId, status: "approved" },
                    data: { status: "revoked", reviewerUserId, reviewNote, reviewedAt: now },
                });
                if (updated.count !== 1) throw new ConflictException("Artist claim is no longer approved");
                await tx.artist.update({
                    where: { id: claim.artistId },
                    data: { claimStatus: "unclaimed" },
                });
            } else {
                if (claim.status !== "pending") {
                    throw new ConflictException("Only a pending artist claim can be reviewed");
                }

                if (decision === "approve") {
                    if (
                        claim.artist.userId !== null
                        || claim.artist.profileType !== "public_artist"
                        || claim.artist.claimStatus !== "unclaimed"
                    ) {
                        throw new ConflictException("Artist profile is no longer available to claim");
                    }
                    const eligibleCredit = await tx.releaseArtistCredit.findFirst({
                        where: {
                            artistId: claim.artistId,
                            role: { in: MAIN_ARTIST_CREDIT_ROLES },
                            identityStatus: { not: "ambiguous" },
                        },
                        select: { id: true },
                    });
                    if (!eligibleCredit) {
                        throw new ConflictException("Artist no longer has an eligible main credit");
                    }
                    const artistUpdated = await tx.artist.updateMany({
                        where: {
                            id: claim.artistId,
                            userId: null,
                            profileType: "public_artist",
                            claimStatus: "unclaimed",
                        },
                        data: { claimStatus: "claimed" },
                    });
                    if (artistUpdated.count !== 1) {
                        throw new ConflictException("Artist profile is no longer available to claim");
                    }
                }

                const updated = await tx.artistClaimRequest.updateMany({
                    where: { id: claimId, status: "pending" },
                    data: {
                        status: decision === "approve" ? "approved" : "rejected",
                        reviewerUserId,
                        reviewNote,
                        reviewedAt: now,
                    },
                });
                if (updated.count !== 1) throw new ConflictException("Artist claim is no longer pending");

                if (decision === "approve") {
                    const competingClaims = await tx.artistClaimRequest.findMany({
                        where: {
                            artistId: claim.artistId,
                            status: "pending",
                            id: { not: claimId },
                        },
                        select: { id: true },
                    });
                    if (competingClaims.length > 0) {
                        const autoRejected = await tx.artistClaimRequest.updateMany({
                            where: {
                                artistId: claim.artistId,
                                status: "pending",
                                id: { not: claimId },
                            },
                            data: {
                                status: "rejected",
                                reviewerUserId,
                                reviewNote: AUTO_CLAIM_REJECTION_NOTE,
                                reviewedAt: now,
                            },
                        });
                        if (autoRejected.count !== competingClaims.length) {
                            throw new ConflictException("A competing claim changed during review");
                        }
                        await tx.artistClaimDecisionEvent.createMany({
                            data: competingClaims.map(({ id }) => ({
                                claimId: id,
                                actorUserId: reviewerUserId,
                                decision: "reject",
                                note: AUTO_CLAIM_REJECTION_NOTE,
                                createdAt: now,
                            })),
                        });
                    }
                }
            }

            await tx.artistClaimDecisionEvent.create({
                data: {
                    claimId,
                    actorUserId: reviewerUserId,
                    decision,
                    note: reviewNote,
                    createdAt: now,
                },
            });

            return tx.artistClaimRequest.findUnique({
                where: { id: claimId },
                select: {
                    id: true,
                    artistId: true,
                    status: true,
                    createdAt: true,
                    updatedAt: true,
                    reviewedAt: true,
                },
            });
            });
        } catch (error) {
            if (isUniqueConstraintViolation(error)) {
                throw new ConflictException("Another claim has already been approved for this artist");
            }
            throw error;
        }
    }

    /**
     * Typeahead search used by the upload/publish studio so artists can pick an
     * existing profile instead of accidentally minting a duplicate via a typo or
     * a casing/spacing difference. Catalog credit resolution links names to
     * profiles by exact (case-insensitive) displayName when no ID is supplied.
     * Same-name profiles must remain separate results so callers can select
     * the exact credited identity. Rank exact match > prefix > claimed > art.
     */
    async searchByName(query: string, limit = 8): Promise<ArtistSearchResult[]> {
        const normalized = (query ?? "").trim();
        if (normalized.length < 1) {
            return [];
        }
        const take = Math.min(Math.max(Math.trunc(limit) || 8, 1), 25);

        const matches = await prisma.artist.findMany({
            where: {
                displayName: { contains: normalized, mode: "insensitive" },
                profileType: "public_artist",
                userId: null,
            },
            // Over-fetch so ranking still has enough to fill `take`.
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
        return matches
            .sort((a, b) => artistRelevanceScore(b, lowerQuery) - artistRelevanceScore(a, lowerQuery)
                || a.displayName.localeCompare(b.displayName)
                || a.id.localeCompare(b.id))
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

    /**
     * Owner-scoped profile edit (image/bio/social links/website). Separate
     * from `updateSettings` (`remixConsent`) — this never touches consent,
     * and settings updates never touch these fields.
     */
    async updateProfile(userId: string, artistId: string, input: UpdateArtistProfileInput) {
        const artist = await this.requireProfileEditor(userId, artistId);

        const imageUrl = normalizeOptionalUrl(input.imageUrl, "imageUrl");
        const summary = normalizeOptionalSummary(input.summary);
        const socialLinks = normalizeOptionalSocialLinks(input.socialLinks);
        const website = normalizeOptionalUrl(input.website, "website");

        const data: Record<string, unknown> = {};
        if (imageUrl !== undefined) data.imageUrl = imageUrl;
        if (summary !== undefined) data.summary = summary;
        if (socialLinks !== undefined) data.socialLinks = socialLinks === null ? Prisma.JsonNull : socialLinks;
        if (website !== undefined) data.website = website;

        if (Object.keys(data).length === 0) {
            return artist;
        }

        return prisma.artist.update({
            where: { id: artist.id },
            data,
        });
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

    private async requireProfileEditor(userId: string, artistId: string) {
        const artist = await prisma.artist.findUnique({ where: { id: artistId } });
        if (!artist) throw new NotFoundException("Artist profile not found");
        if (await hasArtistManagementAccess(userId, artistId, "profile_edit")) return artist;
        throw new ForbiddenException("You do not manage this artist profile");
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
