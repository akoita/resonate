import { prisma } from "../../db/prisma";

/**
 * What the account actually holds for one stem (#2511). Library rows used to
 * take `isOwned`, `tokenId`, `listingId` and `purchaseDate` from the client;
 * they now come only from these server records.
 */
export interface StemHolding {
    tokenId: string;
    /** The on-chain id of the holder's active listing, when they list it. */
    listingId: string | null;
    /** The holder's latest purchase of the stem; null when only listed. */
    purchasedAt: Date | null;
}

export interface LibraryOwnershipFields {
    isOwned: boolean;
    tokenId: string | null;
    listingId: string | null;
    purchaseDate: Date | null;
}

const NOT_OWNED: LibraryOwnershipFields = { isOwned: false, tokenId: null, listingId: null, purchaseDate: null };

const STEM_PREVIEW_PATH = /\/catalog\/stems\/([^/?#]+)\/preview/;

function stemIdFromPreview(value?: string | null): string | null {
    if (!value) return null;
    let path = value;
    try {
        path = new URL(value, "http://library.local").pathname;
    } catch {
        // Keep the raw value.
    }
    const match = path.match(STEM_PREVIEW_PATH);
    if (!match) return null;
    try {
        return decodeURIComponent(match[1]);
    } catch {
        return match[1];
    }
}

/**
 * The stem a catalog library row stands for: the stem named by its preview
 * URL, else the client key the web app saves owned stems under (the stem id).
 * Rows for a full catalog track (`catalogTrackId`) and device files have none.
 */
export function libraryRowStemId(row: {
    source: string;
    catalogTrackId?: string | null;
    clientKey?: string | null;
    previewUrl?: string | null;
    remoteUrl?: string | null;
}): string | null {
    if (row.source !== "remote" || row.catalogTrackId) return null;
    return stemIdFromPreview(row.previewUrl) ?? stemIdFromPreview(row.remoteUrl) ?? row.clientKey ?? null;
}

/** The ownership fields to store and return for a row, from the holdings map. */
export function ownershipFor(stemId: string | null, holdings: Map<string, StemHolding>): LibraryOwnershipFields {
    const holding = stemId ? holdings.get(stemId) : undefined;
    if (!holding) return NOT_OWNED;
    return {
        isOwned: true,
        tokenId: holding.tokenId,
        listingId: holding.listingId,
        purchaseDate: holding.purchasedAt,
    };
}

/**
 * Every address the account buys or lists from, lowercased: a wallet-auth
 * user id (the smart-account address), the Wallet row's address and owner,
 * and the on-chain buyer of the account's confirmed agent purchases. Mirrors
 * the addresses the collection endpoint reads.
 */
export async function holderAddresses(userId: string): Promise<string[]> {
    const addresses = new Set<string>();
    if (/^0x[0-9a-fA-F]{40}$/.test(userId)) addresses.add(userId.toLowerCase());

    const [wallet, agentTxs] = await Promise.all([
        prisma.wallet.findUnique({ where: { userId }, select: { address: true, ownerAddress: true } }),
        prisma.agentTransaction.findMany({
            where: { userId, status: "confirmed", txHash: { not: null } },
            select: { txHash: true },
        }),
    ]);
    if (wallet?.address) addresses.add(wallet.address.toLowerCase());
    if (wallet?.ownerAddress) addresses.add(wallet.ownerAddress.toLowerCase());

    const txHashes = agentTxs.map((tx) => tx.txHash).filter((hash): hash is string => Boolean(hash));
    if (txHashes.length > 0) {
        const agentPurchases = await prisma.stemPurchase.findMany({
            where: { transactionHash: { in: txHashes } },
            select: { buyerAddress: true },
        });
        for (const purchase of agentPurchases) addresses.add(purchase.buyerAddress.toLowerCase());
    }
    return Array.from(addresses);
}

/**
 * The account's holdings for the given stems: stems it bought, and stems it
 * currently lists for sale. Server records only; nothing the client sends.
 */
export async function resolveStemHoldings(userId: string, stemIds: Iterable<string>): Promise<Map<string, StemHolding>> {
    const ids = Array.from(new Set(stemIds));
    const holdings = new Map<string, StemHolding>();
    if (ids.length === 0) return holdings;

    const addresses = await holderAddresses(userId);
    if (addresses.length === 0) return holdings;

    const [purchases, listings] = await Promise.all([
        prisma.stemPurchase.findMany({
            where: { buyerAddress: { in: addresses }, listing: { stemId: { in: ids } } },
            select: { purchasedAt: true, listing: { select: { stemId: true, tokenId: true } } },
            orderBy: { purchasedAt: "desc" },
        }),
        prisma.stemListing.findMany({
            where: { sellerAddress: { in: addresses }, status: "active", stemId: { in: ids } },
            select: { stemId: true, tokenId: true, listingId: true },
        }),
    ]);

    for (const purchase of purchases) {
        const stemId = purchase.listing.stemId;
        if (!stemId || holdings.has(stemId)) continue;
        holdings.set(stemId, {
            tokenId: purchase.listing.tokenId.toString(),
            listingId: null,
            purchasedAt: purchase.purchasedAt,
        });
    }
    for (const listing of listings) {
        if (!listing.stemId) continue;
        const current = holdings.get(listing.stemId);
        if (current) {
            current.listingId = listing.listingId.toString();
        } else {
            holdings.set(listing.stemId, {
                tokenId: listing.tokenId.toString(),
                listingId: listing.listingId.toString(),
                purchasedAt: null,
            });
        }
    }
    return holdings;
}
