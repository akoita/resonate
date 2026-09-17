import { Injectable, NotFoundException } from "@nestjs/common";
import { prisma } from "../../db/prisma";
import { pseudonymousAnalyticsActorId } from "../analytics/analytics_identity";

/**
 * Every identifier that reaches a person's data.
 *
 * A person is not one identifier: `docs/engineering/personal-data-inventory.md`
 * names five, and an export or erasure that starts from `userId` alone leaves
 * the other four untouched.
 */
export interface ResolvedPersonalIdentifiers {
  userId: string;
  /**
   * Derived with `pseudonymousAnalyticsActorId`, never reimplemented here — a
   * second implementation that drifts means an erasure silently misses a
   * person's analytics. Undefined only if the derivation declines the id.
   */
  actorId?: string;
  walletAddresses: string[];
  ownerAddresses: string[];
  artistIds: string[];
  sessionIds: string[];
}

/**
 * Ethereum addresses are stored in mixed case across tables: some paths persist
 * the EIP-55 checksummed form, others persist lowercase. A case-sensitive match
 * would miss rows that are the same address, so every address is lowercased
 * before comparison and the same address seen in two cases collapses to one
 * entry.
 */
function normalizeAddress(address?: string | null): string | undefined {
  const normalized = address?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function uniqueAddresses(addresses: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  for (const address of addresses) {
    const normalized = normalizeAddress(address);
    if (normalized) {
      seen.add(normalized);
    }
  }
  return [...seen];
}

@Injectable()
export class PersonalDataResolverService {
  /**
   * Resolve one user into every identifier their data is keyed by.
   *
   * Throws when the user does not exist rather than returning an empty set: a
   * caller that silently resolved a non-user would go on to "erase" nothing and
   * report success.
   */
  async resolve(userId: string): Promise<ResolvedPersonalIdentifiers> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }

    const [wallet, faucetAttempts, artists, sessions] = await Promise.all([
      prisma.wallet.findUnique({
        where: { userId: user.id },
        select: { address: true, ownerAddress: true },
      }),
      // SignupFaucetAttempt has no User relation, so no cascade reaches it and
      // no join finds it — but its walletAddress is the person's wallet by
      // definition, and it keys Notification/CuratorReputation rows too.
      prisma.signupFaucetAttempt.findMany({
        where: { userId: user.id },
        select: { walletAddress: true },
      }),
      prisma.artist.findMany({
        where: { userId: user.id },
        select: { id: true },
      }),
      prisma.session.findMany({
        where: { userId: user.id },
        select: { id: true },
      }),
    ]);

    return {
      userId: user.id,
      actorId: pseudonymousAnalyticsActorId(user.id),
      walletAddresses: uniqueAddresses([
        wallet?.address,
        ...faucetAttempts.map((attempt) => attempt.walletAddress),
      ]),
      // The EOA behind a smart account is a distinct identifier from the
      // account address it controls, and is personal data in its own right.
      ownerAddresses: uniqueAddresses([wallet?.ownerAddress]),
      artistIds: artists.map((artist) => artist.id),
      sessionIds: sessions.map((session) => session.id),
    };
  }
}

/**
 * Counts, not values, for a governance-log `details` field: writing a person's
 * wallet addresses into a log line would create a fresh copy of the data the
 * log exists to prove we removed.
 */
export function describeResolvedIdentifiers(resolved: ResolvedPersonalIdentifiers) {
  return {
    userId: resolved.userId,
    hasActorId: Boolean(resolved.actorId),
    walletAddressCount: resolved.walletAddresses.length,
    ownerAddressCount: resolved.ownerAddresses.length,
    artistIdCount: resolved.artistIds.length,
    sessionIdCount: resolved.sessionIds.length,
  };
}
