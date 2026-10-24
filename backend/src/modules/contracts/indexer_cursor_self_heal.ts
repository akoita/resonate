import { prisma } from "../../db/prisma";

const SEPOLIA_CHAIN_ID = 11155111;
const STALE_BELOW_BLOCK = 10290000n;
const RECENT_SAFE_BLOCK = 10295000n;

/**
 * Boot-time repair: fast-forward a Sepolia contract-indexer cursor that is
 * millions of blocks behind. The write bumps `leaseEpoch` (#2360) so a poller
 * already running in another process is fenced instead of overwriting the
 * fast-forward with its own progress; it re-acquires on its next cycle and
 * reads the new cursor. Returns true when the cursor was moved.
 */
export async function fastForwardStaleIndexerCursor(chainId: number): Promise<boolean> {
  if (chainId !== SEPOLIA_CHAIN_ID) return false;
  const state = await prisma.indexerState.findUnique({ where: { chainId } });
  if (state && !(state.lastBlockNumber < STALE_BELOW_BLOCK && state.lastBlockNumber > 0n)) {
    return false;
  }
  console.log(`[Self-Healing] Detected stale indexer state (Block ${state?.lastBlockNumber}). Fast-forwarding to ${RECENT_SAFE_BLOCK}...`);
  await prisma.indexerState.upsert({
    where: { chainId },
    update: { lastBlockNumber: RECENT_SAFE_BLOCK, leaseEpoch: { increment: 1 } },
    create: { chainId, lastBlockNumber: RECENT_SAFE_BLOCK },
  });
  console.log(`[Self-Healing] Indexer fast-forward complete.`);
  return true;
}
