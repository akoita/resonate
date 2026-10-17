import { Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { getAddress } from "viem";
import { prisma } from "../../db/prisma";
import { writeAdminAuditEvent } from "../accounts/admin_audit_event";
import { AuthService } from "../auth/auth.service";
import {
  ADMIN_USERS_DEFAULT_PAGE_SIZE,
  AdminUserOrder,
  AdminUserRoleFilter,
  AdminUserSort,
  AdminUserStatus,
  ListAdminUsersQueryDto,
} from "./admin_users.dto";

const DAY_MS = 86_400_000;

export type AdminUserRole = "admin" | "operator" | "agent" | "artist";

export type AdminUsersOverview = {
  totalUsers: number;
  newUsers: { d7: number; d30: number };
  activeUsers: { d1: number; d7: number; d30: number };
  suspended: number;
  closed: number;
  generatedAt: string;
};

export type AdminUserRow = {
  id: string;
  walletAddress: string | null;
  createdAt: string;
  lastSignInAt: string | null;
  lastActiveDay: string | null;
  roles: AdminUserRole[];
  artistName: string | null;
  accountStatus: AdminUserStatus;
  counts: { purchases: number; pledges: number; releases: number };
  /** #2180: another user's id equals this one under lowercase (a case-variant duplicate). */
  possibleDuplicate: boolean;
};

export type AdminUsersPage = { items: AdminUserRow[]; page: number; pageSize: number; total: number };

export type AdminUserDetail = AdminUserRow & {
  wallet: { address: string; ownerAddress: string | null; accountType: string; chainId: number } | null;
  passkeyCount: number;
  status: {
    /** Effective status: a suspension past its end date reads as active. */
    accountStatus: AdminUserStatus;
    reason: string | null;
    until: string | null;
    changedAt: string | null;
    /** When a pending erasure (self-service or operator closure) is due, else null. */
    scheduledErasureAt: string | null;
  };
  activity: {
    recentPurchases: Array<{
      id: string;
      purchasedAt: string;
      totalPaid: string;
      assetSymbol: string;
      assetDecimals: number;
    }>;
    recentPledges: Array<{
      id: string;
      campaignId: string;
      createdAt: string;
      status: string;
      amountUnits: string;
      assetSymbol: string;
      assetDecimals: number;
    }>;
    recentReleases: Array<{ id: string; title: string; createdAt: string; status: string }>;
    noticesReceived: number;
  };
  adminActions: Array<{ action: string; actorUserId: string; createdAt: string; detail: unknown }>;
};

/** The columns every directory row is built from. Never selects `email`. */
const rowSelect = {
  id: true,
  createdAt: true,
  lastSignInAt: true,
  lastActiveAt: true,
  accountStatus: true,
  accountStatusUntil: true,
  wallet: { select: { address: true, ownerAddress: true } },
  artist: { select: { id: true, displayName: true } },
} satisfies Prisma.UserSelect;

type RowRecord = Prisma.UserGetPayload<{ select: typeof rowSelect }>;

type Counts = { purchases: number; pledges: number; releases: number };

type Allowlists = Record<"admin" | "operator" | "agent", Set<string>>;

function readAllowlists(): Allowlists {
  return {
    admin: new Set(AuthService.allowlistedAddresses("admin")),
    operator: new Set(AuthService.allowlistedAddresses("operator")),
    agent: new Set(AuthService.allowlistedAddresses("agent")),
  };
}

function toInt(value: unknown, fallback: number): number {
  if (value === undefined || value === null || value === "") return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

/** Account status as the platform enforces it: a suspension past its end date counts as active. */
function effectiveStatus(
  status: AdminUserStatus,
  until: Date | null,
  now: Date,
): AdminUserStatus {
  return status === "suspended" && until && until.getTime() <= now.getTime() ? "active" : status;
}

/** Addresses a purchase can be recorded under: lowercase and the checksummed form the indexer may store. */
function purchaseAddressVariants(addresses: string[]): string[] {
  const variants = new Set<string>();
  for (const address of addresses) {
    const lower = address.toLowerCase();
    variants.add(lower);
    try {
      variants.add(getAddress(lower));
    } catch {
      // Not a valid address (a placeholder or test value); the lowercase form is all there is.
    }
  }
  return [...variants];
}

/**
 * Operator-facing users directory, overview and detail (#2166).
 *
 * Read-only apart from the audit event a detail view writes. It never reads or
 * returns `User.email` (a placeholder for wallet accounts), balances, session
 * keys or any credential, and erased accounts are invisible to it.
 */
@Injectable()
export class AdminUsersService {
  async overview(now: Date = new Date()): Promise<AdminUsersOverview> {
    const live: Prisma.UserWhereInput = { erasedAt: null };
    const since = (days: number) => new Date(now.getTime() - days * DAY_MS);
    const [totalUsers, n7, n30, a1, a7, a30, suspended, closed] = await Promise.all([
      prisma.user.count({ where: live }),
      prisma.user.count({ where: { ...live, createdAt: { gte: since(7) } } }),
      prisma.user.count({ where: { ...live, createdAt: { gte: since(30) } } }),
      prisma.user.count({ where: { ...live, lastActiveAt: { gte: since(1) } } }),
      prisma.user.count({ where: { ...live, lastActiveAt: { gte: since(7) } } }),
      prisma.user.count({ where: { ...live, lastActiveAt: { gte: since(30) } } }),
      prisma.user.count({ where: { ...live, ...this.statusWhere("suspended", now) } }),
      prisma.user.count({ where: { ...live, ...this.statusWhere("closed", now) } }),
    ]);
    return {
      totalUsers,
      newUsers: { d7: n7, d30: n30 },
      activeUsers: { d1: a1, d7: a7, d30: a30 },
      suspended,
      closed,
      generatedAt: now.toISOString(),
    };
  }

  async list(query: ListAdminUsersQueryDto, now: Date = new Date()): Promise<AdminUsersPage> {
    const page = Math.max(1, toInt(query.page, 1));
    const pageSize = Math.min(100, Math.max(1, toInt(query.pageSize, ADMIN_USERS_DEFAULT_PAGE_SIZE)));
    const sort = (query.sort ?? "createdAt") as AdminUserSort;
    const order = (query.order ?? "desc") as AdminUserOrder;
    const allowlists = readAllowlists();

    const where = this.buildWhere(query, allowlists, now);
    const orderBy: Prisma.UserOrderByWithRelationInput[] = [
      sort === "createdAt"
        ? { createdAt: order }
        : { [sort]: { sort: order, nulls: "last" } },
      { id: "asc" },
    ];

    const [total, users] = await Promise.all([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        orderBy,
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: rowSelect,
      }),
    ]);

    const [counts, duplicates] = await Promise.all([
      this.countsFor(users),
      this.duplicateKeysFor(users),
    ]);
    return {
      items: users.map((user) => this.toRow(user, counts.get(user.id), allowlists, now, duplicates)),
      page,
      pageSize,
      total,
    };
  }

  /** 404 when unknown or erased. Writes exactly one audit event per successful view. */
  async detail(actorUserId: string, id: string, now: Date = new Date()): Promise<AdminUserDetail> {
    const user = await prisma.user.findFirst({
      where: { id, erasedAt: null },
      select: {
        ...rowSelect,
        accountStatusReason: true,
        accountStatusChangedAt: true,
        wallet: {
          select: { address: true, ownerAddress: true, accountType: true, chainId: true },
        },
      },
    });
    if (!user) throw new NotFoundException("User not found");

    // Logged before anything is returned: an operator never sees a record whose
    // access was not recorded.
    await writeAdminAuditEvent(
      { actorUserId, action: "user.detail_viewed", targetUserId: user.id },
      { required: true },
    );

    const allowlists = readAllowlists();
    const addresses = this.walletAddresses(user);
    const purchaseAddresses = purchaseAddressVariants(addresses);

    const [counts, duplicates, passkeyCount, recentPurchases, recentPledges, recentReleases, noticesReceived, actions, closure] =
      await Promise.all([
        this.countsFor([user]),
        this.duplicateKeysFor([user]),
        prisma.passkeyIdentity.count({ where: { userId: user.id } }),
        purchaseAddresses.length
          ? prisma.stemPurchase.findMany({
              where: { buyerAddress: { in: purchaseAddresses } },
              orderBy: { purchasedAt: "desc" },
              take: 5,
              select: {
                id: true,
                purchasedAt: true,
                totalPaid: true,
                paymentAssetSymbol: true,
                paymentAssetDecimals: true,
              },
            })
          : Promise.resolve([]),
        prisma.showPledge.findMany({
          where: { userId: user.id },
          orderBy: { createdAt: "desc" },
          take: 5,
          select: {
            id: true,
            campaignId: true,
            createdAt: true,
            status: true,
            amountUnits: true,
            paymentAssetSymbol: true,
            paymentAssetDecimals: true,
          },
        }),
        user.artist
          ? prisma.release.findMany({
              where: { artistId: user.artist.id },
              orderBy: { createdAt: "desc" },
              take: 5,
              select: { id: true, title: true, createdAt: true, status: true },
            })
          : Promise.resolve([]),
        prisma.notice.count({ where: { recipientUserId: user.id } }),
        prisma.adminAuditEvent.findMany({
          where: { targetUserId: user.id },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { action: true, actorUserId: true, createdAt: true, detail: true },
        }),
        prisma.accountClosureRequest.findFirst({
          where: { userId: user.id, status: "pending" },
          orderBy: { requestedAt: "desc" },
          select: { dueAt: true },
        }),
      ]);

    const row = this.toRow(user, counts.get(user.id), allowlists, now, duplicates);
    const status = effectiveStatus(user.accountStatus, user.accountStatusUntil, now);
    const restricted = status !== "active";
    return {
      ...row,
      wallet: user.wallet
        ? {
            address: user.wallet.address,
            ownerAddress: user.wallet.ownerAddress,
            accountType: user.wallet.accountType,
            chainId: user.wallet.chainId,
          }
        : null,
      passkeyCount,
      status: {
        accountStatus: status,
        reason: restricted ? (user.accountStatusReason ?? null) : null,
        until: restricted ? (user.accountStatusUntil?.toISOString() ?? null) : null,
        changedAt: user.accountStatusChangedAt?.toISOString() ?? null,
        scheduledErasureAt: closure?.dueAt.toISOString() ?? null,
      },
      activity: {
        recentPurchases: recentPurchases.map((p) => ({
          id: p.id,
          purchasedAt: p.purchasedAt.toISOString(),
          totalPaid: p.totalPaid,
          assetSymbol: p.paymentAssetSymbol,
          assetDecimals: p.paymentAssetDecimals,
        })),
        recentPledges: recentPledges.map((p) => ({
          id: p.id,
          campaignId: p.campaignId,
          createdAt: p.createdAt.toISOString(),
          status: p.status,
          amountUnits: p.amountUnits,
          assetSymbol: p.paymentAssetSymbol,
          assetDecimals: p.paymentAssetDecimals,
        })),
        recentReleases: recentReleases.map((r) => ({
          id: r.id,
          title: r.title,
          createdAt: r.createdAt.toISOString(),
          status: r.status,
        })),
        noticesReceived,
      },
      adminActions: actions.map((a) => ({
        action: a.action,
        actorUserId: a.actorUserId,
        createdAt: a.createdAt.toISOString(),
        detail: a.detail,
      })),
    };
  }

  // ============ Query building ============

  /** Stored status, with an expired suspension counted as active (the enforced view). */
  private statusWhere(status: AdminUserStatus, now: Date): Prisma.UserWhereInput {
    if (status === "closed") return { accountStatus: "closed" };
    const suspendedNow: Prisma.UserWhereInput = {
      accountStatus: "suspended",
      OR: [{ accountStatusUntil: null }, { accountStatusUntil: { gt: now } }],
    };
    if (status === "suspended") return suspendedNow;
    return {
      OR: [
        { accountStatus: "active" },
        { accountStatus: "suspended", accountStatusUntil: { lte: now } },
      ],
    };
  }

  private roleWhere(role: AdminUserRoleFilter, allowlists: Allowlists): Prisma.UserWhereInput {
    if (role === "artist") return { artist: { isNot: null } };
    if (role === "listener") {
      const roleConditions = (["admin", "operator", "agent"] as const)
        .map((r) => this.allowlistWhere(allowlists[r]))
        .filter((c): c is Prisma.UserWhereInput => c !== null);
      return { artist: { is: null }, ...(roleConditions.length ? { NOT: roleConditions } : {}) };
    }
    // An empty allowlist matches nobody.
    return this.allowlistWhere(allowlists[role]) ?? { id: { in: [] } };
  }

  /** A user whose id or wallet (smart account or owner) address is on the list. */
  private allowlistWhere(list: Set<string>): Prisma.UserWhereInput | null {
    if (list.size === 0) return null;
    const addresses = [...list];
    return {
      OR: [
        { id: { in: addresses } },
        { wallet: { is: { address: { in: addresses } } } },
        // `ownerAddress` is nullable: spelling out "not null" keeps the condition
        // two-valued, so negating it (the `listener` role) cannot hit SQL NULL logic.
        { wallet: { is: { AND: [{ ownerAddress: { not: null } }, { ownerAddress: { in: addresses } }] } } },
      ],
    };
  }

  private buildWhere(
    query: ListAdminUsersQueryDto,
    allowlists: Allowlists,
    now: Date,
  ): Prisma.UserWhereInput {
    const and: Prisma.UserWhereInput[] = [{ erasedAt: null }];

    const q = typeof query.q === "string" ? query.q.trim() : "";
    if (q) {
      and.push({
        OR: [
          { id: q },
          { wallet: { is: { address: { startsWith: q, mode: "insensitive" } } } },
          { wallet: { is: { ownerAddress: { startsWith: q, mode: "insensitive" } } } },
          { artist: { is: { displayName: { contains: q, mode: "insensitive" } } } },
        ],
      });
    }
    if (query.status) and.push(this.statusWhere(query.status as AdminUserStatus, now));
    if (query.role) and.push(this.roleWhere(query.role as AdminUserRoleFilter, allowlists));

    if (query.activeWithinDays !== undefined) {
      const cutoff = new Date(now.getTime() - toInt(query.activeWithinDays, 0) * DAY_MS);
      and.push({ lastActiveAt: { gte: cutoff } });
    }
    if (query.inactiveForDays !== undefined) {
      const cutoff = new Date(now.getTime() - toInt(query.inactiveForDays, 0) * DAY_MS);
      and.push({
        OR: [
          { lastActiveAt: { lt: cutoff } },
          { lastActiveAt: null, createdAt: { lt: cutoff } },
        ],
      });
    }
    return { AND: and };
  }

  // ============ Row building ============

  private walletAddresses(user: Pick<RowRecord, "wallet">): string[] {
    const set = new Set<string>();
    if (user.wallet?.address) set.add(user.wallet.address.toLowerCase());
    if (user.wallet?.ownerAddress) set.add(user.wallet.ownerAddress.toLowerCase());
    return [...set];
  }

  /**
   * Purchases, pledges and releases for a whole page in three grouped queries
   * (no per-row lookups).
   */
  private async countsFor(users: RowRecord[]): Promise<Map<string, Counts>> {
    const result = new Map<string, Counts>();
    const ids = users.map((u) => u.id);
    const artistToUser = new Map<string, string>();
    const purchaseAddressToUsers = new Map<string, string[]>();
    for (const user of users) {
      result.set(user.id, { purchases: 0, pledges: 0, releases: 0 });
      if (user.artist) artistToUser.set(user.artist.id, user.id);
      for (const address of this.walletAddresses(user)) {
        const owners = purchaseAddressToUsers.get(address) ?? [];
        owners.push(user.id);
        purchaseAddressToUsers.set(address, owners);
      }
    }
    if (ids.length === 0) return result;

    const [pledges, releases, purchases] = await Promise.all([
      prisma.showPledge.groupBy({
        by: ["userId"],
        where: { userId: { in: ids } },
        _count: { _all: true },
      }),
      artistToUser.size
        ? prisma.release.groupBy({
            by: ["artistId"],
            where: { artistId: { in: [...artistToUser.keys()] } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
      purchaseAddressToUsers.size
        ? prisma.stemPurchase.groupBy({
            by: ["buyerAddress"],
            where: { buyerAddress: { in: purchaseAddressVariants([...purchaseAddressToUsers.keys()]) } },
            _count: { _all: true },
          })
        : Promise.resolve([]),
    ]);

    for (const row of pledges) {
      if (row.userId) result.get(row.userId)!.pledges = row._count._all;
    }
    for (const row of releases) {
      const userId = artistToUser.get(row.artistId);
      if (userId) result.get(userId)!.releases = row._count._all;
    }
    // A person's smart-account and owner addresses can both be buyer addresses,
    // and an address may be stored in either case form: every grouped row counts once.
    for (const row of purchases) {
      for (const userId of purchaseAddressToUsers.get(row.buyerAddress.toLowerCase()) ?? []) {
        result.get(userId)!.purchases += row._count._all;
      }
    }
    return result;
  }

  /**
   * Lowercased ids, among the given page, that more than one `User` shares
   * (#2180). One scan of `User` for the whole page; no per-row lookups.
   */
  private async duplicateKeysFor(users: RowRecord[]): Promise<Set<string>> {
    const keys = [...new Set(users.map((u) => u.id.toLowerCase()))];
    if (keys.length === 0) return new Set();
    const rows = await prisma.$queryRaw<Array<{ key: string }>>(Prisma.sql`
      SELECT lower(id) AS key
      FROM "User"
      WHERE lower(id) = ANY(${keys}::text[])
      GROUP BY lower(id)
      HAVING count(*) > 1
    `);
    return new Set(rows.map((row) => row.key));
  }

  private toRow(
    user: RowRecord,
    counts: Counts | undefined,
    allowlists: Allowlists,
    now: Date,
    duplicates: Set<string> = new Set(),
  ): AdminUserRow {
    const addresses = new Set([user.id.toLowerCase(), ...this.walletAddresses(user)]);
    const roles: AdminUserRole[] = [];
    for (const role of ["admin", "operator", "agent"] as const) {
      if ([...addresses].some((a) => allowlists[role].has(a))) roles.push(role);
    }
    if (user.artist) roles.push("artist");
    return {
      id: user.id,
      walletAddress: user.wallet?.address ?? null,
      createdAt: user.createdAt.toISOString(),
      lastSignInAt: user.lastSignInAt?.toISOString() ?? null,
      lastActiveDay: user.lastActiveAt?.toISOString().slice(0, 10) ?? null,
      roles,
      artistName: user.artist?.displayName ?? null,
      accountStatus: effectiveStatus(user.accountStatus, user.accountStatusUntil, now),
      counts: counts ?? { purchases: 0, pledges: 0, releases: 0 },
      possibleDuplicate: duplicates.has(user.id.toLowerCase()),
    };
  }
}
