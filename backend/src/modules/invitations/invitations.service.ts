import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  generateInvitationCode,
  hashInvitationCode,
  invitationCodeHint,
  normalizeInvitationCode,
} from "./invitation_code";
import {
  resolveArtistListenerInvites,
  resolveFoundingArtistCap,
  resolveRegistrationMode,
  WAITLIST_CONSENT_VERSION,
  type RegistrationMode,
} from "./registration_config";

export type InvitationRole = "listener" | "artist";
export const INVITATION_ROLES: readonly InvitationRole[] = ["listener", "artist"];

/**
 * Why a code cannot be used. `invalid` covers an unknown and a revoked code
 * alike, so a check never tells a guesser that a code once existed.
 */
export type InvitationRefusal = "invalid" | "expired" | "used" | "artist_cap_reached";

export type InvitationCheck =
  | { status: "valid"; role: InvitationRole }
  | { status: InvitationRefusal };

/** A use of a code that is counted but not yet tied to an account. See {@link InvitationsService.reserve}. */
export interface InvitationReservation {
  invitationId: string;
  role: InvitationRole;
}

const ARTIST_LISTENER_INVITE_DAYS = 30;
const MAX_ADMIN_USES = 500;
const MAX_EXPIRY_DAYS = 365;
const DAY_MS = 24 * 60 * 60 * 1000;
/** Serializes artist reservations, so two people cannot both take the last founding-artist place. */
// Lock key (2662, 1) in `reserve`, written inline so Postgres types both arguments as int4.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Tx = Prisma.TransactionClient;

type InvitationRow = {
  id: string;
  role: string;
  maxUses: number;
  useCount: number;
  expiresAt: Date | null;
  revokedAt: Date | null;
};

function asRole(value: string): InvitationRole {
  return value === "artist" ? "artist" : "listener";
}

function refusalFor(row: InvitationRow | null, now: Date): InvitationRefusal | null {
  if (!row || row.revokedAt) return "invalid";
  if (row.expiresAt && row.expiresAt.getTime() <= now.getTime()) return "expired";
  if (row.useCount >= row.maxUses) return "used";
  return null;
}

export class InvitationRefusedError extends Error {
  constructor(readonly status: InvitationRefusal) {
    super(`Invitation refused: ${status}`);
  }
}

/**
 * Invitation-only registration, the founding-artist cap and the waiting list (#2662).
 *
 * A code is consumed in two steps so that a failure in between cannot leave an
 * account without its invitation: {@link reserve} counts the use (and, for an
 * artist code, takes a founding-artist place under a lock), the caller creates
 * the account, then {@link complete} records which account used it, or
 * {@link release} gives the use back.
 */
@Injectable()
export class InvitationsService {
  mode(): RegistrationMode {
    return resolveRegistrationMode();
  }

  async registrationStatus() {
    const mode = this.mode();
    const cap = resolveFoundingArtistCap();
    const artistCapReached = cap !== null && (await this.foundingArtistCount(prisma)) >= cap;
    return { mode, artistCapReached, waitlist: mode === "invite" };
  }

  /** Founding-artist places taken: every counted use of an artist code, completed or reserved. */
  private async foundingArtistCount(tx: Tx | typeof prisma): Promise<number> {
    const sum = await tx.invitation.aggregate({ where: { role: "artist" }, _sum: { useCount: true } });
    return sum._sum.useCount ?? 0;
  }

  private async findByCode(tx: Tx | typeof prisma, code: unknown) {
    const normalized = normalizeInvitationCode(code);
    if (!normalized) return null;
    return tx.invitation.findUnique({ where: { codeHash: hashInvitationCode(normalized) } });
  }

  /** Read-only check of a code, for the sign-up screen. Consumes nothing. */
  async check(code: unknown, now = new Date()): Promise<InvitationCheck> {
    const row = await this.findByCode(prisma, code);
    const refusal = refusalFor(row, now);
    if (refusal || !row) return { status: refusal ?? "invalid" };
    const role = asRole(row.role);
    if (role === "artist") {
      const cap = resolveFoundingArtistCap();
      if (cap !== null && (await this.foundingArtistCount(prisma)) >= cap) {
        return { status: "artist_cap_reached" };
      }
    }
    return { status: "valid", role };
  }

  /**
   * Count one use of a code. Throws {@link InvitationRefusedError} when the
   * code cannot be used. The increment is conditional, so a code with one use
   * left is taken by exactly one of two simultaneous callers.
   */
  async reserve(code: unknown, now = new Date()): Promise<InvitationReservation> {
    return prisma.$transaction(async (tx) => {
      const row = await this.findByCode(tx, code);
      const refusal = refusalFor(row, now);
      if (refusal || !row) throw new InvitationRefusedError(refusal ?? "invalid");
      const role = asRole(row.role);

      if (role === "artist") {
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(2662, 1)::text AS locked`;
        const cap = resolveFoundingArtistCap();
        if (cap !== null && (await this.foundingArtistCount(tx)) >= cap) {
          throw new InvitationRefusedError("artist_cap_reached");
        }
      }

      const taken = await tx.invitation.updateMany({
        where: {
          id: row.id,
          revokedAt: null,
          useCount: { lt: row.maxUses },
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
        data: { useCount: { increment: 1 } },
      });
      if (taken.count !== 1) throw new InvitationRefusedError("used");
      return { invitationId: row.id, role };
    });
  }

  /** Tie a reserved use to the account that used it. */
  async complete(reservation: InvitationReservation, userId: string) {
    await prisma.$transaction(async (tx) => {
      await tx.invitationRedemption.create({
        data: { invitationId: reservation.invitationId, userId, role: reservation.role },
      });
      const invitation = await tx.invitation.findUnique({
        where: { id: reservation.invitationId },
        select: { waitlistEntryId: true },
      });
      if (invitation?.waitlistEntryId) {
        await tx.waitlistEntry.updateMany({
          where: { id: invitation.waitlistEntryId, userId: null },
          data: { userId },
        });
      }
    });
  }

  /** Give a reserved use back, when the account it was for could not be created. */
  async release(reservation: InvitationReservation) {
    await prisma.invitation.updateMany({
      where: { id: reservation.invitationId, useCount: { gt: 0 } },
      data: { useCount: { decrement: 1 } },
    });
  }

  /** Whether this account redeemed an artist invitation: a founding artist. */
  async isFoundingArtist(userId: string): Promise<boolean> {
    const row = await prisma.invitationRedemption.findFirst({
      where: { userId, role: "artist" },
      select: { id: true },
    });
    return row !== null;
  }

  /**
   * In invitation mode, only a founding artist (or an operator) may create an
   * artist profile. Existing profiles are untouched.
   */
  async assertMayBecomeArtist(userId: string, role?: string) {
    if (this.mode() !== "invite") return;
    if (role === "admin" || role === "operator") return;
    if (await this.isFoundingArtist(userId)) return;
    throw new ForbiddenException({
      code: "artist_invitation_required",
      message: "An artist invitation is needed to set up an artist profile during the preview.",
    });
  }

  /**
   * A signed-in account uses a code: how an existing listener becomes a
   * founding artist. A listener code changes nothing for an existing account.
   */
  async redeemForExistingAccount(userId: string, code: unknown) {
    const check = await this.check(code);
    if (check.status !== "valid") return check;
    if (check.role === "listener") return { status: "already_member" as const };
    if (await this.isFoundingArtist(userId)) return { status: "redeemed" as const, role: "artist" as const };
    let reservation: InvitationReservation;
    try {
      reservation = await this.reserve(code);
    } catch (error) {
      if (error instanceof InvitationRefusedError) return { status: error.status };
      throw error;
    }
    try {
      await this.complete(reservation, userId);
    } catch (error) {
      await this.release(reservation);
      throw error;
    }
    return { status: "redeemed" as const, role: reservation.role };
  }

  // ---------------------------------------------------------------------
  // Operators
  // ---------------------------------------------------------------------

  async create(
    createdByUserId: string,
    input: { role: InvitationRole; maxUses?: number; expiresInDays?: number; waitlistEntryId?: string },
    issuedBy: "operator" | "artist" = "operator",
    now = new Date(),
  ) {
    if (!INVITATION_ROLES.includes(input.role)) throw new BadRequestException("role must be listener or artist");
    const maxUses = input.maxUses ?? 1;
    if (!Number.isInteger(maxUses) || maxUses < 1 || maxUses > MAX_ADMIN_USES) {
      throw new BadRequestException(`maxUses must be a whole number from 1 to ${MAX_ADMIN_USES}`);
    }
    const days = input.expiresInDays;
    if (days !== undefined && (!Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS)) {
      throw new BadRequestException(`expiresInDays must be a whole number from 1 to ${MAX_EXPIRY_DAYS}`);
    }
    const code = generateInvitationCode();
    const normalized = normalizeInvitationCode(code)!;
    const row = await prisma.invitation.create({
      data: {
        codeHash: hashInvitationCode(normalized),
        codeHint: invitationCodeHint(normalized),
        role: input.role,
        maxUses,
        expiresAt: days ? new Date(now.getTime() + days * DAY_MS) : null,
        createdByUserId,
        issuedBy,
        waitlistEntryId: input.waitlistEntryId ?? null,
      },
    });
    // The code itself is returned once, here, and never stored.
    return { ...this.summary(row), code };
  }

  private summary(row: {
    id: string;
    codeHint: string;
    role: string;
    maxUses: number;
    useCount: number;
    expiresAt: Date | null;
    revokedAt: Date | null;
    createdByUserId: string;
    issuedBy: string;
    waitlistEntryId: string | null;
    createdAt: Date;
  }, now = new Date()) {
    const refusal = refusalFor(row, now);
    return {
      id: row.id,
      codeHint: row.codeHint,
      role: asRole(row.role),
      maxUses: row.maxUses,
      useCount: row.useCount,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      revokedAt: row.revokedAt?.toISOString() ?? null,
      createdByUserId: row.createdByUserId,
      issuedBy: row.issuedBy === "artist" ? "artist" : "operator",
      waitlistEntryId: row.waitlistEntryId,
      createdAt: row.createdAt.toISOString(),
      state: row.revokedAt ? "revoked" : refusal === "expired" ? "expired" : refusal === "used" ? "used" : "active",
    };
  }

  async list(limit = 200) {
    const rows = await prisma.invitation.findMany({ orderBy: { createdAt: "desc" }, take: limit });
    const cap = resolveFoundingArtistCap();
    return {
      mode: this.mode(),
      foundingArtists: { used: await this.foundingArtistCount(prisma), cap },
      invitations: rows.map((row) => this.summary(row)),
    };
  }

  async revoke(id: string, now = new Date()) {
    const row = await prisma.invitation.findUnique({ where: { id } });
    if (!row) throw new NotFoundException("Invitation not found");
    if (row.revokedAt) return this.summary(row);
    const updated = await prisma.invitation.update({ where: { id }, data: { revokedAt: now } });
    return this.summary(updated);
  }

  // ---------------------------------------------------------------------
  // Founding artists' listener codes
  // ---------------------------------------------------------------------

  async listMine(userId: string) {
    const allowance = resolveArtistListenerInvites();
    const founding = await this.isFoundingArtist(userId);
    const rows = await prisma.invitation.findMany({
      where: { createdByUserId: userId, issuedBy: "artist" },
      orderBy: { createdAt: "desc" },
    });
    return {
      foundingArtist: founding,
      eligible: founding && allowance > 0,
      allowance: founding ? allowance : 0,
      remaining: founding ? Math.max(0, allowance - rows.length) : 0,
      invitations: rows.map((row) => this.summary(row)),
    };
  }

  async createMine(userId: string) {
    const allowance = resolveArtistListenerInvites();
    if (!(await this.isFoundingArtist(userId)) || allowance === 0) {
      throw new ForbiddenException({ code: "not_founding_artist", message: "Only founding artists can create invitations." });
    }
    const created = await prisma.invitation.count({ where: { createdByUserId: userId, issuedBy: "artist" } });
    if (created >= allowance) {
      throw new ForbiddenException({ code: "allowance_used", message: "You have used all your invitations." });
    }
    return this.create(userId, { role: "listener", maxUses: 1, expiresInDays: ARTIST_LISTENER_INVITE_DAYS }, "artist");
  }

  // ---------------------------------------------------------------------
  // Waiting list
  // ---------------------------------------------------------------------

  /**
   * Join the waiting list. The answer is the same whether or not the address
   * was already listed, so the form cannot be used to test addresses.
   */
  async joinWaitlist(input: { email: unknown; kind: unknown; consent: unknown }, userId?: string, now = new Date()) {
    const email = typeof input.email === "string" ? input.email.trim() : "";
    if (!email || email.length > 254 || !EMAIL_PATTERN.test(email)) {
      throw new BadRequestException("Enter a valid email address.");
    }
    if (input.kind !== "listener" && input.kind !== "artist") {
      throw new BadRequestException("kind must be listener or artist");
    }
    if (input.consent !== true) {
      throw new BadRequestException("Please agree to be contacted about your invitation.");
    }
    const emailNormalized = email.toLowerCase();
    await prisma.waitlistEntry.upsert({
      where: { emailNormalized },
      update: {
        kind: input.kind,
        consentVersion: WAITLIST_CONSENT_VERSION,
        consentedAt: now,
        ...(userId ? { userId } : {}),
      },
      create: {
        email,
        emailNormalized,
        kind: input.kind,
        consentVersion: WAITLIST_CONSENT_VERSION,
        consentedAt: now,
        userId: userId ?? null,
      },
    });
    return { status: "joined" as const };
  }

  async listWaitlist(limit = 1000) {
    const rows = await prisma.waitlistEntry.findMany({
      orderBy: { createdAt: "asc" },
      take: limit,
      include: { invitation: { select: { id: true, useCount: true } } },
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      kind: row.kind === "artist" ? "artist" : "listener",
      consentVersion: row.consentVersion,
      consentedAt: row.consentedAt.toISOString(),
      createdAt: row.createdAt.toISOString(),
      invitedAt: row.invitedAt?.toISOString() ?? null,
      invitationId: row.invitation?.id ?? null,
      joined: row.userId !== null || (row.invitation?.useCount ?? 0) > 0,
    }));
  }

  async deleteWaitlistEntry(id: string) {
    const result = await prisma.waitlistEntry.deleteMany({ where: { id } });
    if (result.count === 0) throw new NotFoundException("Waiting-list entry not found");
    return { deleted: true };
  }

  /**
   * Make a single-use code for a waiting-list entry. Returned once to the
   * operator, who sends it; a new code replaces an earlier unused one.
   */
  async inviteWaitlistEntry(operatorUserId: string, id: string, now = new Date()) {
    const entry = await prisma.waitlistEntry.findUnique({ where: { id }, include: { invitation: true } });
    if (!entry) throw new NotFoundException("Waiting-list entry not found");
    if (entry.invitation) {
      if (entry.invitation.useCount > 0) {
        throw new BadRequestException("This person has already used their invitation.");
      }
      await prisma.invitation.update({
        where: { id: entry.invitation.id },
        data: { revokedAt: entry.invitation.revokedAt ?? now, waitlistEntryId: null },
      });
    }
    const created = await this.create(
      operatorUserId,
      { role: entry.kind === "artist" ? "artist" : "listener", maxUses: 1, expiresInDays: 30, waitlistEntryId: entry.id },
      "operator",
      now,
    );
    await prisma.waitlistEntry.update({ where: { id }, data: { invitedAt: now } });
    return { ...created, email: entry.email };
  }
}
