import type { AdminUserDetail, AdminUserRow, AdminUsersOverview, AdminUsersPage } from "../api";

export const OVERVIEW: AdminUsersOverview = {
  totalUsers: 1234,
  newUsers: { d7: 12, d30: 80 },
  activeUsers: { d1: 21, d7: 140, d30: 480 },
  suspended: 3,
  closed: 2,
  generatedAt: "2026-10-16T09:30:00.000Z",
};

export function userRow(overrides: Partial<AdminUserRow> = {}): AdminUserRow {
  return {
    id: "11111111-aaaa-bbbb-cccc-000000000001",
    walletAddress: "0x1234567890abcdef1234567890abcdef12345678",
    createdAt: "2026-09-01T08:00:00.000Z",
    lastSignInAt: "2026-10-14T18:20:00.000Z",
    lastActiveDay: "2026-10-15",
    roles: [],
    artistName: null,
    accountStatus: "active",
    counts: { purchases: 4, pledges: 1, releases: 0 },
    possibleDuplicate: false,
    ...overrides,
  };
}

export function usersPage(overrides: Partial<AdminUsersPage> = {}): AdminUsersPage {
  return {
    items: [
      userRow(),
      userRow({
        id: "22222222-aaaa-bbbb-cccc-000000000002",
        walletAddress: "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd",
        artistName: "Nova",
        roles: ["artist"],
        accountStatus: "suspended",
        lastSignInAt: null,
        lastActiveDay: null,
        counts: { purchases: 0, pledges: 0, releases: 3 },
      }),
    ],
    page: 1,
    pageSize: 25,
    total: 2,
    ...overrides,
  };
}

export function userDetail(overrides: Partial<AdminUserDetail> = {}): AdminUserDetail {
  return {
    ...userRow({ artistName: "Nova", roles: ["artist"], counts: { purchases: 1, pledges: 1, releases: 1 } }),
    wallet: {
      address: "0x1234567890abcdef1234567890abcdef12345678",
      ownerAddress: "0x9999999999999999999999999999999999999999",
      accountType: "erc4337",
      chainId: 11155111,
    },
    passkeyCount: 2,
    status: { accountStatus: "active", reason: null, until: null, changedAt: null, scheduledErasureAt: null },
    activity: {
      recentPurchases: [{ id: "p1", purchasedAt: "2026-10-10T12:00:00.000Z", totalPaid: "4500000", assetSymbol: "USDC", assetDecimals: 6 }],
      recentPledges: [
        {
          id: "pl1",
          campaignId: "cccccccc-0000-0000-0000-000000000001",
          createdAt: "2026-10-11T12:00:00.000Z",
          status: "confirmed",
          amountUnits: "1200000000000000",
          assetSymbol: "ETH",
          assetDecimals: 18,
        },
      ],
      recentReleases: [{ id: "r1", title: "Night Drive", createdAt: "2026-10-01T12:00:00.000Z", status: "published" }],
      noticesReceived: 3,
    },
    adminActions: [
      {
        action: "account.suspended",
        actorUserId: "0xadmin00000000000000000000000000000001",
        createdAt: "2026-10-12T09:00:00.000Z",
        detail: { reason: "fraud" },
      },
      {
        action: "user.detail_viewed",
        actorUserId: "0xop0000000000000000000000000000000002",
        createdAt: "2026-10-11T09:00:00.000Z",
        detail: null,
      },
    ],
    ...overrides,
  };
}
