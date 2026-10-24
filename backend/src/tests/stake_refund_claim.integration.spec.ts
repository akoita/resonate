/**
 * Content Protection stake refunds in the indexer (#1759) — Testcontainers Postgres.
 *
 * Verifies:
 *   - the indexer decodes StakeRefundClaimed / StakeRefunded logs and publishes
 *     `contract.stake_refunded` (selfClaimed distinguishes the attester's own claim);
 *   - ContractsService marks the stake row inactive with `refundedAt`;
 *   - claim state degrades to "unknown, not claimable" for inactive stakes and
 *     chains without a configured contract, without any RPC call.
 *
 * Run: npm run test:integration
 */

import { encodeAbiParameters, encodeEventTopics, getAddress, parseAbiItem } from 'viem';
import { prisma } from '../db/prisma';
import { ContractsService } from '../modules/contracts/contracts.service';
import { IndexerService } from '../modules/contracts/indexer.service';
import { EventBus } from '../modules/shared/event_bus';
import type { ContractStakeDepositedEvent, ContractStakeRefundedEvent } from '../events/event_types';

const TEST_PREFIX = `stakeclaim_${Date.now()}`;
const CHAIN_ID = 31337;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ATTESTER = `0x${'a'.repeat(40)}` as const;
const USDC = `0x${'b'.repeat(40)}` as const;

function fakeLog(topics: readonly `0x${string}`[], data: `0x${string}`) {
  return {
    transactionHash: `0x${'e'.repeat(64)}`,
    blockNumber: 200n,
    address: `0x${'3'.repeat(40)}`,
    blockHash: `0x${'c'.repeat(64)}`,
    logIndex: 0,
    data,
    topics: [...topics],
    removed: false,
    transactionIndex: 0,
  };
}

describe('Content Protection stake refunds (integration)', () => {
  let eventBus: EventBus;
  let contracts: ContractsService;
  let indexer: IndexerService;
  // Unique numeric token ids so parallel suites never collide on (tokenId, chainId).
  const base = BigInt(Date.now()) * 1000n;
  const claimedTokenId = (base + 1n).toString();
  const refundedTokenId = (base + 2n).toString();

  beforeAll(() => {
    eventBus = new EventBus();
    contracts = new ContractsService(eventBus, {} as any);
    contracts.onModuleInit();
    indexer = new IndexerService(eventBus);
  });

  afterAll(async () => {
    await prisma.contentProtectionStake
      .deleteMany({ where: { chainId: CHAIN_ID, tokenId: { in: [claimedTokenId, refundedTokenId] } } })
      .catch(() => {});
  });

  it('decodes StakeRefundClaimed and publishes a self-claimed refund', async () => {
    const event = parseAbiItem(
      'event StakeRefundClaimed(uint256 indexed tokenId, address indexed attester, address indexed token, uint256 amount)',
    );
    const topics = encodeEventTopics({
      abi: [event],
      eventName: 'StakeRefundClaimed',
      args: { tokenId: 9n, attester: ATTESTER, token: USDC },
    });
    const data = encodeAbiParameters([{ type: 'uint256' }], [10_000_000n]);
    const { eventName, decodedArgs } = (indexer as any).decodeEvent(fakeLog(topics as `0x${string}`[], data));
    expect(eventName).toBe('StakeRefundClaimed');

    const received: ContractStakeRefundedEvent[] = [];
    eventBus.subscribe('contract.stake_refunded', (e) => received.push(e as ContractStakeRefundedEvent));
    await (indexer as any).publishTypedEvent(eventName, decodedArgs, fakeLog(topics as `0x${string}`[], data), CHAIN_ID);

    expect(received).toHaveLength(1);
    expect(received[0]).toEqual(
      expect.objectContaining({
        tokenId: '9',
        // viem decodes indexed addresses checksummed.
        stakerAddress: getAddress(ATTESTER),
        paymentToken: getAddress(USDC),
        amount: '10000000',
        selfClaimed: true,
      }),
    );
  });

  it('decodes the owner-issued StakeRefunded as not self-claimed', async () => {
    const event = parseAbiItem('event StakeRefunded(uint256 indexed tokenId, address indexed staker, uint256 amount)');
    const topics = encodeEventTopics({ abi: [event], eventName: 'StakeRefunded', args: { tokenId: 5n, staker: ATTESTER } });
    const data = encodeAbiParameters([{ type: 'uint256' }], [5n]);
    const { eventName, decodedArgs } = (indexer as any).decodeEvent(fakeLog(topics as `0x${string}`[], data));
    expect(eventName).toBe('StakeRefunded');

    const received: ContractStakeRefundedEvent[] = [];
    eventBus.subscribe('contract.stake_refunded', (e) => received.push(e as ContractStakeRefundedEvent));
    await (indexer as any).publishTypedEvent(eventName, decodedArgs, fakeLog(topics as `0x${string}`[], data), CHAIN_ID);
    expect(received.at(-1)).toEqual(expect.objectContaining({ tokenId: '5', selfClaimed: false }));
  });

  it('marks a claimed or refunded stake inactive with refundedAt', async () => {
    for (const tokenId of [claimedTokenId, refundedTokenId]) {
      const deposited: ContractStakeDepositedEvent = {
        eventName: 'contract.stake_deposited',
        eventVersion: 1,
        occurredAt: new Date('2026-09-01T00:00:00Z').toISOString(),
        tokenId,
        stakerAddress: ATTESTER,
        amount: '5000000000000000',
        chainId: CHAIN_ID,
        contractAddress: `0x${'3'.repeat(40)}`,
        transactionHash: `0x${TEST_PREFIX}dep${tokenId}`,
        blockNumber: '100',
      };
      eventBus.publish(deposited);
    }
    await wait(300);

    const refundedAt = new Date('2026-10-20T12:00:00Z').toISOString();
    const refunds: ContractStakeRefundedEvent[] = [
      { tokenId: claimedTokenId, selfClaimed: true },
      { tokenId: refundedTokenId, selfClaimed: false },
    ].map(({ tokenId, selfClaimed }) => ({
      eventName: 'contract.stake_refunded',
      eventVersion: 1,
      occurredAt: refundedAt,
      tokenId,
      stakerAddress: ATTESTER,
      amount: '5000000000000000',
      selfClaimed,
      chainId: CHAIN_ID,
      contractAddress: `0x${'3'.repeat(40)}`,
      transactionHash: `0x${TEST_PREFIX}ref${tokenId}`,
      blockNumber: '300',
    }));
    refunds.forEach((event) => eventBus.publish(event));
    await wait(300);

    const rows = await prisma.contentProtectionStake.findMany({
      where: { chainId: CHAIN_ID, tokenId: { in: [claimedTokenId, refundedTokenId] } },
    });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.active).toBe(false);
      expect(row.refundedAt?.toISOString()).toBe(refundedAt);
      expect(row.slashedAt).toBeNull();
    }
  });

  it('reports unknown, unclaimable state without an RPC call when it cannot read the contract', async () => {
    const states = await contracts.getStakeClaimStates([
      { tokenId: claimedTokenId, chainId: CHAIN_ID, active: false },
      { tokenId: '1', chainId: 999_999, active: true },
    ]);
    for (const key of [`${CHAIN_ID}:${claimedTokenId}`, '999999:1']) {
      expect(states.get(key)).toEqual({ claimableAt: null, failSafeAt: null, locked: null, claimable: false });
    }
  });
});
