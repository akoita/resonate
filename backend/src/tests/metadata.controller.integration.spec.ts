// @ts-nocheck - Prisma strict types conflict with null values for fallback testing
/**
 * Metadata Controller — Integration Test (Testcontainers)
 *
 * Tests MetadataController response formatting against real Postgres
 * for stemNftMint queries. Uses real ContractsService (all query methods
 * hit real Postgres).
 *
 * Run: npm run test:integration
 */

import { prisma } from '../db/prisma';
import { MetadataController } from '../modules/contracts/metadata.controller';
import { ContractsService } from '../modules/contracts/contracts.service';
import { EventBus } from '../modules/shared/event_bus';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TrustService } from '../modules/trust/trust.service';

const TEST_PREFIX = `meta_${Date.now()}_`;

describe('MetadataController (integration)', () => {
  let controller: MetadataController;
  let contractsService: ContractsService;
  let indexerService: { indexTransaction: jest.Mock };
  let stemId: string;
  let typedDisputeId: string | null = null;
  const creatorWalletAddress = ("0x" + "1".repeat(40)).toLowerCase();
  const payoutOnlyAddress = ("0x" + "2".repeat(40)).toLowerCase();

  beforeAll(async () => {
    // Seed: User → Artist → Release → Track → Stem → StemNftMint
    await prisma.user.create({
      data: { id: creatorWalletAddress, email: `${TEST_PREFIX}@test.resonate` },
    });
    await prisma.artist.create({
      data: {
        id: `${TEST_PREFIX}artist`,
        userId: creatorWalletAddress,
        displayName: 'Meta Artist',
        payoutAddress: payoutOnlyAddress,
      },
    });
    await prisma.release.create({
      data: {
        id: `${TEST_PREFIX}release`,
        title: 'Meta Release',
        artistId: `${TEST_PREFIX}artist`,
        status: 'published',
        rightsRoute: 'LIMITED_MONITORING',
        rightsFlags: ['NEEDS_PROOF_OF_CONTROL', 'RESTRICT_MARKETPLACE', 'RESTRICT_PAYOUTS'],
        rightsReason: 'Uploader has not yet completed release control review.',
      },
    });
    await prisma.track.create({
      data: { id: `${TEST_PREFIX}track`, title: 'Meta Track', releaseId: `${TEST_PREFIX}release`, position: 1 },
    });
    const stem = await prisma.stem.create({
      data: { trackId: `${TEST_PREFIX}track`, type: 'vocals', uri: '/meta/vocals.mp3' },
    });
    stemId = stem.id;

    await prisma.stemNftMint.create({
      data: {
        stemId,
        tokenId: 42n,
        chainId: 31337,
        contractAddress: '0xStemNFT',
        creatorAddress: '0xCreator',
        royaltyBps: 500,
        remixable: true,
        metadataUri: 'ipfs://QmTest',
        transactionHash: '0x' + 'a'.repeat(64),
        blockNumber: 100n,
        mintedAt: new Date(),
      },
    });

    // Real ContractsService — all query methods use real Postgres
    const eventBus = new EventBus();
    const trustService = new TrustService(new ConfigService());
    contractsService = new ContractsService(eventBus as any, trustService);
    indexerService = {
      indexTransaction: jest.fn().mockResolvedValue({ processed: 0 }),
    };
    controller = new MetadataController(
      contractsService,
      indexerService as any,
      undefined as any,
      eventBus,
    );

    await prisma.curatorReputation.create({
      data: {
        walletAddress: creatorWalletAddress,
        verifiedHuman: true,
        humanVerificationProvider: "mock",
        humanVerificationStatus: "verified",
        humanVerifiedAt: new Date("2026-04-09T19:51:38.721Z"),
      },
    });

    await prisma.contentAttestation.create({
      data: {
        tokenId: `${TEST_PREFIX}token`,
        chainId: 11155111,
        attesterAddress: creatorWalletAddress,
        contentHash: "0x" + "a".repeat(64),
        fingerprintHash: "0x" + "b".repeat(64),
        metadataURI: "resonate://release/meta-release",
        transactionHash: "0x" + "c".repeat(64),
        blockNumber: 101n,
        attestedAt: new Date("2026-04-09T20:00:00.000Z"),
      },
    });

    await prisma.contentProtectionStake.create({
      data: {
        tokenId: `${TEST_PREFIX}token`,
        chainId: 11155111,
        stakerAddress: creatorWalletAddress,
        amount: "10000000000000000",
        active: true,
        depositedAt: new Date("2026-04-09T20:00:00.000Z"),
        transactionHash: "0x" + "d".repeat(64),
        blockNumber: 102n,
      },
    });
  });

  afterAll(async () => {
    await prisma.contentProtectionStake.deleteMany({ where: { tokenId: `${TEST_PREFIX}token` } }).catch(() => {});
    await prisma.contentAttestation.deleteMany({ where: { tokenId: `${TEST_PREFIX}token` } }).catch(() => {});
    await prisma.rightsEvidence.deleteMany({
      where: {
        OR: [
          { subjectId: `${TEST_PREFIX}release` },
          ...(typedDisputeId ? [{ subjectId: typedDisputeId }] : []),
        ],
      },
    }).catch(() => {});
    await prisma.rightsEvidenceBundle.deleteMany({
      where: {
        OR: [
          { subjectId: `${TEST_PREFIX}release` },
          ...(typedDisputeId ? [{ subjectId: typedDisputeId }] : []),
        ],
      },
    }).catch(() => {});
    await prisma.releaseRightsUpgradeRequest.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.dispute.deleteMany({ where: { tokenId: `${TEST_PREFIX}typed-token` } }).catch(() => {});
    await prisma.curatorReputation.deleteMany({ where: { walletAddress: creatorWalletAddress } }).catch(() => {});
    await prisma.stemListingIntent.deleteMany({ where: { stemId } }).catch(() => {});
    await prisma.stemListing.deleteMany({ where: { stemId } }).catch(() => {});
    await prisma.stemNftMint.deleteMany({ where: { stemId } }).catch(() => {});
    await prisma.stem.deleteMany({ where: { trackId: `${TEST_PREFIX}track` } }).catch(() => {});
    await prisma.track.deleteMany({ where: { releaseId: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.release.delete({ where: { id: `${TEST_PREFIX}release` } }).catch(() => {});
    await prisma.artist.delete({ where: { id: `${TEST_PREFIX}artist` } }).catch(() => {});
    await prisma.user.delete({ where: { id: creatorWalletAddress } }).catch(() => {});
  });


  // ===== getStemNftInfo — uses real Prisma =====

  describe('getStemNftInfo', () => {
    it('returns null when stem has no NFT mint', async () => {
      const result = await controller.getStemNftInfo('nonexistent');
      expect(result).toBeNull();
    });

    it('returns formatted NFT info from real DB', async () => {
      const result = await controller.getStemNftInfo(stemId);
      expect(result).not.toBeNull();
      expect(result!.tokenId).toBe('42');
      expect(result!.chainId).toBe(31337);
      expect(result!.contractAddress).toBe('0xStemNFT');
      expect(result!.creator).toBe('0xCreator');
    });
  });

  // ===== getCollection =====

  describe('getCollection', () => {
    // Owner-only since #2139: a wallet-auth caller's userId IS its address.
    const ownerRequest = (address: string) => ({ user: { userId: address, role: 'listener' } });

    describe('caller address set (#2139)', () => {
      const callerId = `${TEST_PREFIX}caller`;
      const strangerId = `${TEST_PREFIX}stranger`;
      const callerSmartAccount = `0x${'7a'.repeat(20)}`;
      const callerEoa = `0x${'7b'.repeat(20)}`;
      const strangerAddress = `0x${'7c'.repeat(20)}`;
      const strangerEoa = `0x${'7d'.repeat(20)}`;

      beforeAll(async () => {
        await prisma.user.createMany({
          data: [
            { id: callerId, email: `${TEST_PREFIX}caller@test.resonate` },
            { id: strangerId, email: `${TEST_PREFIX}stranger@test.resonate` },
            { id: callerSmartAccount, email: `${TEST_PREFIX}sa@test.resonate` },
          ],
        });
        // Mixed case in storage proves the set is lowercased.
        await prisma.wallet.createMany({
          data: [
            {
              userId: callerId,
              address: `0x${callerSmartAccount.slice(2).toUpperCase()}`,
              ownerAddress: `0x${callerEoa.slice(2).toUpperCase()}`,
              chainId: 31337,
            },
            { userId: strangerId, address: strangerAddress, ownerAddress: strangerEoa, chainId: 31337 },
          ],
        });
      });

      afterAll(async () => {
        await prisma.wallet
          .deleteMany({ where: { userId: { in: [callerId, strangerId] } } })
          .catch(() => {});
        await prisma.user
          .deleteMany({ where: { id: { in: [callerId, strangerId, callerSmartAccount] } } })
          .catch(() => {});
      });

      it("returns the caller's wallet address and owner EOA, lowercased, and nothing of other users", async () => {
        const addresses = await contractsService.getCallerWalletAddresses(callerId);
        expect([...addresses].sort()).toEqual([callerSmartAccount, callerEoa].sort());
        expect(addresses.has(strangerAddress)).toBe(false);
        expect(addresses.has(strangerEoa)).toBe(false);
      });

      it('includes the wallet-auth userId when it is an address', async () => {
        const addresses = await contractsService.getCallerWalletAddresses(callerSmartAccount);
        expect([...addresses]).toEqual([callerSmartAccount]);
      });

      it('returns an empty set for a non-address user without a wallet', async () => {
        const addresses = await contractsService.getCallerWalletAddresses(`${TEST_PREFIX}nobody`);
        expect(addresses.size).toBe(0);
      });

      it("lets the caller read their own owner EOA's collection but not another user's", async () => {
        const caller = { user: { userId: callerId, role: 'listener' } };
        await expect(controller.getCollection(caller, callerEoa)).resolves.toEqual(
          expect.objectContaining({ total: 0 }),
        );
        await expect(controller.getCollection(caller, strangerAddress)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        await expect(controller.getCollection(caller, strangerEoa)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
      });
    });

    it('returns empty collection for wallet with no stems', async () => {
      const emptyWallet = `0x${'e'.repeat(40)}`;
      const result = await controller.getCollection(ownerRequest(emptyWallet), emptyWallet);
      expect(result.total).toBe(0);
      expect(result.stems).toEqual([]);
    });

    it('exposes the source trackId on purchased stems (#1175)', async () => {
      const buyerAddress = `0x${'e1175'.padEnd(40, '0')}`.toLowerCase();
      const listing = await prisma.stemListing.create({
        data: {
          listingId: 911750n,
          stemId,
          tokenId: 42n,
          chainId: 31337,
          contractAddress: '0xStemMarket',
          sellerAddress: `0x${'5'.repeat(40)}`,
          pricePerUnit: '1000000',
          amount: 1n,
          paymentToken: `0x${'6'.repeat(40)}`,
          expiresAt: new Date(Date.now() + 86_400_000),
          transactionHash: `${TEST_PREFIX}collection_listing`,
          blockNumber: 200n,
          status: 'sold',
          listedAt: new Date(),
        },
      });
      await prisma.stemPurchase.create({
        data: {
          listingId: listing.id,
          buyerAddress,
          amount: 1n,
          totalPaid: '1000000',
          royaltyPaid: '0',
          protocolFeePaid: '0',
          sellerReceived: '1000000',
          licenseType: 'remix',
          transactionHash: `${TEST_PREFIX}collection_buy`,
          blockNumber: 201n,
          purchasedAt: new Date(),
        },
      });

      try {
        const result = await controller.getCollection(ownerRequest(buyerAddress), buyerAddress);
        expect(result.total).toBe(1);
        expect(result.stems[0]).toEqual(
          expect.objectContaining({
            id: stemId,
            trackId: `${TEST_PREFIX}track`,
            tokenId: '42',
          }),
        );
      } finally {
        await prisma.stemPurchase
          .deleteMany({ where: { transactionHash: `${TEST_PREFIX}collection_buy` } })
          .catch(() => {});
        await prisma.stemListing
          .deleteMany({ where: { transactionHash: `${TEST_PREFIX}collection_listing` } })
          .catch(() => {});
      }
    });

    describe('license tier and holding (#2042)', () => {
      const tierPrefix = `${TEST_PREFIX}tier_`;
      let listingSeq = 920420n;

      async function seedListing(sellerAddress: string, status: 'sold' | 'active', tag: string) {
        listingSeq += 1n;
        return prisma.stemListing.create({
          data: {
            listingId: listingSeq,
            stemId,
            tokenId: 42n,
            chainId: 31337,
            contractAddress: '0xStemMarket',
            sellerAddress,
            pricePerUnit: '1000000',
            amount: 1n,
            paymentToken: `0x${'6'.repeat(40)}`,
            expiresAt: new Date(Date.now() + 86_400_000),
            transactionHash: `${tierPrefix}listing_${tag}`,
            blockNumber: 300n,
            status,
            listedAt: new Date(),
          },
        });
      }

      async function seedPurchase(
        listingDbId: string,
        buyerAddress: string,
        licenseType: 'personal' | 'remix' | 'commercial',
        tag: string,
        purchasedAt: Date,
      ) {
        await prisma.stemPurchase.create({
          data: {
            listingId: listingDbId,
            buyerAddress,
            amount: 1n,
            totalPaid: '1000000',
            royaltyPaid: '0',
            protocolFeePaid: '0',
            sellerReceived: '1000000',
            licenseType,
            transactionHash: `${tierPrefix}buy_${tag}`,
            blockNumber: 301n,
            purchasedAt,
          },
        });
      }

      afterEach(async () => {
        await prisma.stemPurchase
          .deleteMany({ where: { transactionHash: { startsWith: tierPrefix } } })
          .catch(() => {});
        await prisma.stemListing
          .deleteMany({ where: { transactionHash: { startsWith: tierPrefix } } })
          .catch(() => {});
      });

      it('returns the best tier across every purchase of the same stem', async () => {
        const buyerAddress = `0x${'a2042'.padEnd(40, '1')}`.toLowerCase();
        const seller = `0x${'5'.repeat(40)}`;
        const personalListing = await seedListing(seller, 'sold', 'personal');
        const remixListing = await seedListing(seller, 'sold', 'remix');
        // Personal first, remix later: the newest purchase is the remix one,
        // and the older personal purchase must not hide it.
        await seedPurchase(personalListing.id, buyerAddress, 'personal', 'p1', new Date(Date.now() - 60_000));
        await seedPurchase(remixListing.id, buyerAddress, 'remix', 'r1', new Date());

        const result = await controller.getCollection(ownerRequest(buyerAddress), buyerAddress);
        expect(result.total).toBe(1);
        expect(result.stems[0]).toEqual(
          expect.objectContaining({ id: stemId, licenseType: 'remix', holding: 'purchased' }),
        );
      });

      it('keeps the higher tier even when a lower tier was bought last', async () => {
        const buyerAddress = `0x${'b2042'.padEnd(40, '1')}`.toLowerCase();
        const seller = `0x${'5'.repeat(40)}`;
        const commercialListing = await seedListing(seller, 'sold', 'commercial');
        const remixListing = await seedListing(seller, 'sold', 'remix2');
        await seedPurchase(commercialListing.id, buyerAddress, 'commercial', 'c1', new Date(Date.now() - 60_000));
        await seedPurchase(remixListing.id, buyerAddress, 'remix', 'r2', new Date());

        const result = await controller.getCollection(ownerRequest(buyerAddress), buyerAddress);
        expect(result.total).toBe(1);
        expect(result.stems[0]).toEqual(
          expect.objectContaining({ id: stemId, licenseType: 'commercial', holding: 'purchased' }),
        );
      });

      it('returns no license for a stem the wallet only lists', async () => {
        const sellerAddress = `0x${'c2042'.padEnd(40, '1')}`.toLowerCase();
        await seedListing(sellerAddress, 'active', 'listed');

        const result = await controller.getCollection(ownerRequest(sellerAddress), sellerAddress);
        expect(result.total).toBe(1);
        expect(result.stems[0]).toEqual(
          expect.objectContaining({ id: stemId, licenseType: null, holding: 'listed' }),
        );
        expect(result.stems[0].activeListingId).toBeDefined();
      });
    });
  });

  // ===== getListings =====

  describe('getListings', () => {
    it('returns empty listings when none are seeded', async () => {
      const result = await controller.getListings();
      expect(result.listings).toBeDefined();
      expect(result.listings.length).toBe(0);
      expect(result.total).toBe(0);
      expect(result.limit).toBe(20);
      expect(result.offset).toBe(0);
    });

    it('returns the payment token for ERC-20 marketplace listings', async () => {
      const paymentToken = ('0x' + '3'.repeat(40)).toLowerCase();
      const transactionHash = '0x' + 'e'.repeat(64);

      await prisma.stemListing.create({
        data: {
          listingId: 841n,
          stemId,
          tokenId: 42n,
          chainId: 31337,
          contractAddress: '0xStemNFT',
          sellerAddress: creatorWalletAddress,
          pricePerUnit: '50000',
          amount: 1n,
          paymentToken,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          transactionHash,
          blockNumber: 103n,
          status: 'active',
          listedAt: new Date(),
        },
      });

      try {
        const result = await controller.getListings(undefined, undefined, '31337');
        const listing = result.listings.find((item) => item.listingId === '841');

        expect(listing).toBeDefined();
        expect(listing!.chainId).toBe(31337);
        expect(listing!.paymentToken).toBe(paymentToken);
        expect(listing!.price).toBe('50000');
      } finally {
        await prisma.stemListing.deleteMany({ where: { transactionHash } });
      }
    });

    it('filters marketplace listings by exact stem id', async () => {
      const matchingTxHash = '0x' + '6'.repeat(64);
      const otherTxHash = '0x' + '7'.repeat(64);
      const otherStem = await prisma.stem.create({
        data: { trackId: `${TEST_PREFIX}track`, type: 'drums', uri: '/meta/drums.mp3' },
      });

      await prisma.stemListing.createMany({
        data: [
          {
            listingId: 842n,
            stemId,
            tokenId: 42n,
            chainId: 31337,
            contractAddress: '0xStemNFT',
            sellerAddress: creatorWalletAddress,
            pricePerUnit: '50000',
            amount: 1n,
            paymentToken: ('0x' + '3'.repeat(40)).toLowerCase(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            transactionHash: matchingTxHash,
            blockNumber: 104n,
            status: 'active',
            listedAt: new Date(),
          },
          {
            listingId: 843n,
            stemId: otherStem.id,
            tokenId: 43n,
            chainId: 31337,
            contractAddress: '0xStemNFT',
            sellerAddress: creatorWalletAddress,
            pricePerUnit: '50000',
            amount: 1n,
            paymentToken: ('0x' + '3'.repeat(40)).toLowerCase(),
            expiresAt: new Date(Date.now() + 60 * 60 * 1000),
            transactionHash: otherTxHash,
            blockNumber: 105n,
            status: 'active',
            listedAt: new Date(),
          },
        ],
      });

      try {
        const result = await controller.getListings(
          'active',
          undefined,
          '31337',
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          undefined,
          stemId,
        );

        expect(result.listings.map((listing) => listing.listingId)).toEqual(['842']);
        expect(result.total).toBe(1);
      } finally {
        await prisma.stemListing.deleteMany({
          where: { transactionHash: { in: [matchingTxHash, otherTxHash] } },
        });
        await prisma.stem.delete({ where: { id: otherStem.id } }).catch(() => {});
      }
    });

    it('carries the stem source on each listing and filters the marketplace by it (#1976)', async () => {
      const officialStem = await prisma.stem.create({
        data: {
          trackId: `${TEST_PREFIX}track`,
          type: 'bass',
          uri: '/meta/bass.wav',
          mimeType: 'audio/wav',
          source: 'official',
        },
      });
      const separatedStem = await prisma.stem.create({
        data: {
          trackId: `${TEST_PREFIX}track`,
          type: 'drums',
          uri: '/meta/drums.mp3',
          mimeType: 'audio/mpeg',
          source: 'separated',
          separationModel: 'demucs-htdemucs-6s',
        },
      });
      const txHashes = ['0x' + '5'.repeat(64), '0x' + '6'.repeat(64)];
      await prisma.stemListing.createMany({
        data: [officialStem, separatedStem].map((stem, index) => ({
          listingId: BigInt(870 + index),
          stemId: stem.id,
          tokenId: BigInt(70 + index),
          chainId: 31337,
          contractAddress: '0xStemNFT',
          sellerAddress: creatorWalletAddress,
          pricePerUnit: '50000',
          amount: 1n,
          paymentToken: ('0x' + '3'.repeat(40)).toLowerCase(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          transactionHash: txHashes[index],
          blockNumber: BigInt(110 + index),
          status: 'active',
          listedAt: new Date(),
        })),
      });

      try {
        const args = (source?: string) =>
          [
            'active', undefined, '31337', undefined, undefined, undefined, undefined, undefined,
            undefined, undefined, undefined, undefined, undefined, undefined, source,
          ] as const;
        const all = await controller.getListings(...args());
        const byId = new Map(all.listings.map((listing) => [listing.listingId, listing]));
        expect(byId.get('870')!.stem).toEqual(
          expect.objectContaining({
            source: 'official',
            sourceLabel: 'Official',
            lossless: true,
            separationModel: null,
            mimeType: 'audio/wav',
          }),
        );
        expect(byId.get('871')!.stem).toEqual(
          expect.objectContaining({
            source: 'separated',
            sourceLabel: 'Separated (AI)',
            lossless: false,
            separationModel: 'demucs-htdemucs-6s',
            mimeType: 'audio/mpeg',
          }),
        );

        const official = await controller.getListings(...args('official'));
        expect(official.listings.map((listing) => listing.listingId)).toEqual(['870']);
        const separated = await controller.getListings(...args('separated'));
        expect(separated.listings.map((listing) => listing.listingId)).toEqual(['871']);
        await expect(controller.getListings(...args('ai-made'))).rejects.toThrow('source must be official or separated');
      } finally {
        await prisma.stemListing.deleteMany({ where: { transactionHash: { in: txHashes } } });
        await prisma.stem.deleteMany({ where: { id: { in: [officialStem.id, separatedStem.id] } } });
      }
    });

    it('hydrates an indexed listing when the frontend listing intent arrives after the indexer', async () => {
      const previousChainId = process.env.AA_CHAIN_ID;
      const previousIndexerChainId = process.env.INDEXER_CHAIN_ID;
      process.env.AA_CHAIN_ID = '31337';
      process.env.INDEXER_CHAIN_ID = '31337';
      const transactionHash = '0x' + 'f'.repeat(64);
      const stablecoinToken = ('0x' + '4'.repeat(40)).toLowerCase();

      await prisma.stemListing.create({
        data: {
          listingId: 859n,
          stemId,
          tokenId: 42n,
          chainId: 31337,
          contractAddress: '0xMarketplace',
          sellerAddress: creatorWalletAddress,
          // On-chain price from the Listed event (chain values win, #2041).
          pricePerUnit: '50000',
          amount: 1n,
          paymentToken: '0x0000000000000000000000000000000000000000',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          transactionHash,
          blockNumber: 104n,
          status: 'active',
          listedAt: new Date(),
        },
      });

      try {
        indexerService.indexTransaction.mockClear();
        await controller.notifyListingCreated({ user: { userId: creatorWalletAddress } }, {
          tokenId: '42',
          chainId: 31337,
          sellerAddress: creatorWalletAddress,
          price: '99999',
          amount: '1',
          paymentToken: stablecoinToken,
          durationSeconds: '86400',
          transactionHash,
          stemId,
          licenseType: 'personal',
        });

        const listing = await prisma.stemListing.findFirst({
          where: { transactionHash, listingId: 859n },
        });
        expect(listing).not.toBeNull();
        expect(listing!.paymentToken).toBe(stablecoinToken);
        expect(listing!.pricePerUnit).toBe('50000');
        expect(listing!.sellerAddress).toBe(creatorWalletAddress);
        expect(indexerService.indexTransaction).toHaveBeenCalledWith(transactionHash, 31337);
      } finally {
        if (previousChainId === undefined) {
          delete process.env.AA_CHAIN_ID;
        } else {
          process.env.AA_CHAIN_ID = previousChainId;
        }
        if (previousIndexerChainId === undefined) {
          delete process.env.INDEXER_CHAIN_ID;
        } else {
          process.env.INDEXER_CHAIN_ID = previousIndexerChainId;
        }
        await prisma.stemListingIntent.deleteMany({ where: { transactionHash } });
        await prisma.stemListing.deleteMany({ where: { transactionHash } });
      }
    });

    it('ignores a mismatched notified chain id and stamps records with the indexer chain', async () => {
      // The Sold/Cancelled handlers correlate events to listings by
      // (listingId, chainId) using the polling indexer's chain — listing
      // records written under a client-supplied chainId would never be
      // marked sold and their purchases never recorded.
      const previousChainId = process.env.AA_CHAIN_ID;
      const previousIndexerChainId = process.env.INDEXER_CHAIN_ID;
      process.env.AA_CHAIN_ID = '31337';
      process.env.INDEXER_CHAIN_ID = '31337';
      const transactionHash = '0x' + '8'.repeat(64);
      const notifiedChainId = 84532;

      try {
        indexerService.indexTransaction.mockClear();
        await controller.notifyListingCreated({ user: { userId: creatorWalletAddress } }, {
          tokenId: '99',
          chainId: notifiedChainId,
          sellerAddress: creatorWalletAddress,
          price: '50000',
          amount: '1',
          paymentToken: ('0x' + '9'.repeat(40)).toLowerCase(),
          durationSeconds: '86400',
          transactionHash,
          stemId,
          licenseType: 'personal',
        });

        const intent = await prisma.stemListingIntent.findFirst({
          where: { transactionHash, tokenId: 99n },
        });
        expect(intent).not.toBeNull();
        expect(intent!.chainId).toBe(31337);
        expect(indexerService.indexTransaction).toHaveBeenCalledWith(transactionHash, 31337);
      } finally {
        if (previousChainId === undefined) {
          delete process.env.AA_CHAIN_ID;
        } else {
          process.env.AA_CHAIN_ID = previousChainId;
        }
        if (previousIndexerChainId === undefined) {
          delete process.env.INDEXER_CHAIN_ID;
        } else {
          process.env.INDEXER_CHAIN_ID = previousIndexerChainId;
        }
        await prisma.stemListingIntent.deleteMany({ where: { transactionHash } });
      }
    });

    it('backfills native fallback listing rows from stored listing intents', async () => {
      const transactionHash = '0x' + 'b'.repeat(64);
      const stablecoinToken = ('0x' + '5'.repeat(40)).toLowerCase();

      await prisma.stemListingIntent.create({
        data: {
          transactionHash,
          tokenId: 42n,
          chainId: 31337,
          stemId,
          sellerAddress: creatorWalletAddress,
          pricePerUnit: '50000',
          amount: 1n,
          paymentToken: stablecoinToken,
          licenseType: 'personal',
        },
      });
      await prisma.stemListing.create({
        data: {
          listingId: 860n,
          stemId,
          tokenId: 42n,
          chainId: 31337,
          contractAddress: '0xMarketplace',
          sellerAddress: creatorWalletAddress,
          // On-chain price; only the payment asset is backfilled (#2041).
          pricePerUnit: '40000',
          amount: 1n,
          paymentToken: '0x0000000000000000000000000000000000000000',
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          transactionHash,
          blockNumber: 105n,
          status: 'active',
          listedAt: new Date(),
        },
      });

      try {
        const result = await controller.getListings(undefined, undefined, '31337');
        const listing = result.listings.find((item) => item.listingId === '860');
        expect(listing).toBeDefined();
        expect(listing!.paymentToken).toBe(stablecoinToken);
        expect(listing!.price).toBe('40000');

        const persisted = await prisma.stemListing.findFirst({
          where: { transactionHash, listingId: 860n },
        });
        expect(persisted!.paymentToken).toBe(stablecoinToken);
        expect(persisted!.pricePerUnit).toBe('40000');
      } finally {
        await prisma.stemListingIntent.deleteMany({ where: { transactionHash } });
        await prisma.stemListing.deleteMany({ where: { transactionHash } });
      }
    });
  });

  // ===== getListingById =====

  describe('getListingById', () => {
    it('throws NotFoundException when listing not found', async () => {
      await expect(controller.getListingById('31337', '999')).rejects.toThrow(NotFoundException);
    });

    it('returns active public listing details', async () => {
      const transactionHash = '0x' + 'b'.repeat(64);

      await prisma.stemListing.create({
        data: {
          listingId: 861n,
          stemId,
          tokenId: 42n,
          chainId: 31337,
          contractAddress: '0xStemNFT',
          sellerAddress: creatorWalletAddress,
          pricePerUnit: '50000',
          amount: 1n,
          paymentToken: ('0x' + '3'.repeat(40)).toLowerCase(),
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
          transactionHash,
          blockNumber: 106n,
          status: 'active',
          listedAt: new Date(),
        },
      });

      try {
        const result = await controller.getListingById('31337', '861');

        expect(result.listingId).toBe('861');
        expect(result.amount).toBe('1');
        expect(result.status).toBe('active');
      } finally {
        await prisma.stemListing.deleteMany({ where: { transactionHash } });
      }
    });

    it('hides expired listing details from the public listing endpoint', async () => {
      const transactionHash = '0x' + 'c'.repeat(64);

      await prisma.stemListing.create({
        data: {
          listingId: 862n,
          stemId,
          tokenId: 42n,
          chainId: 31337,
          contractAddress: '0xStemNFT',
          sellerAddress: creatorWalletAddress,
          pricePerUnit: '50000',
          amount: 1n,
          paymentToken: ('0x' + '3'.repeat(40)).toLowerCase(),
          expiresAt: new Date(Date.now() - 60 * 60 * 1000),
          transactionHash,
          blockNumber: 107n,
          status: 'active',
          listedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
        },
      });

      try {
        await expect(controller.getListingById('31337', '862')).rejects.toThrow(NotFoundException);
      } finally {
        await prisma.stemListing.deleteMany({ where: { transactionHash } });
      }
    });
  });

  // ===== getEarnings =====

  describe('getEarnings', () => {
    it('returns zero ETH for no earnings', async () => {
      const result = await controller.getEarnings('0xNobody');
      expect(result.totalEth).toBe('0');
      expect(result.totalPayments).toBe(0);
    });
  });

  // ===== getContractMetadata =====

  describe('getContractMetadata', () => {
    it('returns collection-level metadata', async () => {
      const result = await controller.getContractMetadata('31337');
      expect(result.name).toBe('Resonate Stems');
      expect(result.description).toContain('Audio stem NFTs');
      expect(result.seller_fee_basis_points).toBe(500);
    });
  });

  describe('getContentProtectionByRelease', () => {
    it('uses the creator wallet identity instead of payout address for human verification and protection records', async () => {
      const result = await contractsService.getContentProtectionByRelease(`${TEST_PREFIX}release`);
      expect(result).not.toBeNull();
      expect(result!.humanVerificationStatus).toBe('human_verified');
      expect(result!.humanVerifiedAt).toBe('2026-04-09T19:51:38.721Z');
      expect(result!.attested).toBe(true);
      expect(result!.staked).toBe(true);
      expect(result!.stakeAmount).toBe('10000000000000000');
    });

    it('returns the recorded native stake asset with its decimals', async () => {
      const result = await contractsService.getContentProtectionByRelease(`${TEST_PREFIX}release`);
      expect(result!.stakeAssetSymbol).toBe('ETH');
      expect(result!.stakeAssetDecimals).toBe(18);
    });

    it('returns the stablecoin asset, decimals and USD value of a stablecoin stake', async () => {
      const usdc = '0x' + '5'.repeat(40);
      await prisma.contentProtectionStake.updateMany({
        where: { tokenId: `${TEST_PREFIX}token` },
        data: {
          amount: '5000000',
          paymentToken: usdc,
          paymentAssetSymbol: 'USDC',
          paymentAssetDecimals: 6,
          canonicalAmountUsd: '5',
        },
      });
      try {
        const result = await contractsService.getContentProtectionByRelease(`${TEST_PREFIX}release`);
        expect(result!.staked).toBe(true);
        expect(result!.stakeAmount).toBe('5000000');
        expect(result!.stakeAssetSymbol).toBe('USDC');
        expect(result!.stakeAssetDecimals).toBe(6);
        expect(result!.stakeAssetToken).toBe(usdc);
        expect(result!.stakeAmountUsd).toBe('5');
      } finally {
        await prisma.contentProtectionStake.updateMany({
          where: { tokenId: `${TEST_PREFIX}token` },
          data: {
            amount: '10000000000000000',
            paymentToken: '0x0000000000000000000000000000000000000000',
            paymentAssetSymbol: 'ETH',
            paymentAssetDecimals: 18,
            canonicalAmountUsd: null,
          },
        });
      }
    });
  });

  describe('typed rights evidence', () => {
    it('creates an evidence bundle for a release before a formal dispute exists', async () => {
      const bundle = await controller.createEvidenceBundle(
        {
          user: {
            userId: creatorWalletAddress,
            role: 'admin',
          },
        },
        {
          subjectType: 'release',
          subjectId: `${TEST_PREFIX}release`,
          submittedByRole: 'ops',
          submittedByAddress: creatorWalletAddress,
          purpose: 'upload_review',
          summary: 'Ops review packet for upload screening.',
          evidences: [
            {
              kind: 'internal_review_note',
              title: 'Initial review note',
              description: 'Flagged for manual rights follow-up.',
            },
          ],
        },
      );

      expect(bundle.subjectType).toBe('release');
      expect(bundle.subjectId).toBe(`${TEST_PREFIX}release`);
      expect(bundle.evidences).toHaveLength(1);
      expect(bundle.evidences[0].kind).toBe('internal_review_note');
    });

    it('rejects privileged evidence roles from non-admin callers', async () => {
      await expect(
        controller.createEvidenceBundle(
          {
            user: {
              userId: creatorWalletAddress,
              role: 'listener',
            },
          },
          {
            subjectType: 'release',
            subjectId: `${TEST_PREFIX}release`,
            submittedByRole: 'ops',
            submittedByAddress: creatorWalletAddress,
            purpose: 'upload_review',
            evidences: [
              {
                kind: 'internal_review_note',
                title: 'Unauthorized reviewer note',
                description: 'This should be rejected.',
              },
            ],
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('files a dispute with typed evidence and returns hydrated evidence records', async () => {
      const dispute = await controller.fileDispute({
        tokenId: `${TEST_PREFIX}typed-token`,
        reporterAddr: creatorWalletAddress,
        counterStake: '0',
        narrativeSummary: 'The reporter published and controls the original release first.',
        primaryEvidence: {
          kind: 'prior_publication',
          title: 'Canonical release page',
          sourceUrl: 'https://example.com/releases/original',
          claimedRightsholder: 'Meta Artist',
          strength: 'high',
        },
      });

      expect(dispute).not.toBeNull();
      typedDisputeId = dispute.id;
      expect(dispute.tokenId).toBe(`${TEST_PREFIX}typed-token`);
      expect(dispute.evidenceURI).toBe('https://example.com/releases/original');
      expect(dispute.evidences).toHaveLength(2);
      expect(dispute.evidences[0].kind).toBe('prior_publication');
      expect(dispute.evidences[0].title).toBe('Canonical release page');
      expect(dispute.evidences[1].kind).toBe('narrative_statement');

      const persistedEvidence = await prisma.rightsEvidence.findMany({
        where: {
          subjectType: 'dispute',
          subjectId: dispute.id,
        },
        orderBy: { createdAt: 'asc' },
      });

      expect(persistedEvidence).toHaveLength(2);
      expect(persistedEvidence[0].claimedRightsholder).toBe('Meta Artist');
    });
  });

  describe('release rights-upgrade workflow', () => {
    it('creates a creator-submitted rights-upgrade request for a restricted release', async () => {
      const request = await controller.submitReleaseRightsUpgradeRequest(
        {
          user: {
            userId: creatorWalletAddress,
            role: 'listener',
          },
        },
        `${TEST_PREFIX}release`,
        {
          summary: 'I control the official distributor dashboard and prior publication for this release.',
          requestedRoute: 'STANDARD_ESCROW',
          evidences: [
            {
              kind: 'proof_of_control',
              title: 'Official distributor dashboard',
              sourceUrl: 'https://example.com/distributor/meta-release',
              claimedRightsholder: 'Meta Artist',
              description: 'Dashboard account that controls the release.',
              strength: 'high',
            },
          ],
        },
      );

      expect(request).not.toBeNull();
      expect(request!.status).toBe('submitted');
      expect(request!.derivedRightsReviewState).toBe('evidence_submitted');
      expect(request!.derivedRightsVerificationStatus).toBe('evidence_submitted');
      expect(request!.requestedRoute).toBe('STANDARD_ESCROW');
      expect(request!.evidenceBundles?.[0]?.purpose).toBe('rights_upgrade_request');
      expect(request!.evidenceBundles?.[0]?.evidences).toHaveLength(1);
    });

    it('rejects release rights-upgrade submissions from non-owners', async () => {
      await expect(
        controller.submitReleaseRightsUpgradeRequest(
          {
            user: {
              userId: ('0x' + '9'.repeat(40)).toLowerCase(),
              role: 'listener',
            },
          },
          `${TEST_PREFIX}release`,
          {
            summary: 'I should not be allowed to do this.',
            requestedRoute: 'STANDARD_ESCROW',
            evidences: [
              {
                kind: 'proof_of_control',
                title: 'Fake proof',
                sourceUrl: 'https://example.com/fake',
                claimedRightsholder: 'Fake',
                strength: 'medium',
              },
            ],
          },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('approves a rights-upgrade request and promotes the release route', async () => {
      const pending = await prisma.releaseRightsUpgradeRequest.findFirst({
        where: { releaseId: `${TEST_PREFIX}release` },
        orderBy: { createdAt: 'desc' },
      });
      expect(pending).not.toBeNull();

      const reviewed = await controller.reviewReleaseRightsUpgradeRequest(
        {
          user: {
            userId: creatorWalletAddress,
            role: 'admin',
          },
        },
        pending!.id,
        {
          action: 'approved_standard_escrow',
          decisionReason: 'Proof-of-control review passed for the release.',
        },
      );

      expect(reviewed.status).toBe('approved_standard_escrow');
      expect(reviewed.derivedRightsReviewState).toBe('approved_with_limits');
      expect(reviewed.derivedRightsVerificationStatus).toBe('approved_with_limits');

      const release = await prisma.release.findUnique({
        where: { id: `${TEST_PREFIX}release` },
      });
      expect(release?.rightsRoute).toBe('STANDARD_ESCROW');
      expect(release?.rightsFlags).toEqual([]);
      expect(release?.rightsReason).toBe('Proof-of-control review passed for the release.');

      const contentProtection = await controller.getContentProtectionByRelease(`${TEST_PREFIX}release`);
      expect(contentProtection?.rightsReviewState).toBe('approved_with_limits');
      expect(contentProtection?.rightsVerificationStatus).toBe('approved_with_limits');
    });
  });

  // ===== getTokenMetadata =====

  describe('getTokenMetadata', () => {
    it('throws NotFoundException when token not found', async () => {
      await expect(controller.getTokenMetadata('31337', '999')).rejects.toThrow(NotFoundException);
    });
  });
});
