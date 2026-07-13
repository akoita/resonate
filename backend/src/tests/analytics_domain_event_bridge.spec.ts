import { Logger } from "@nestjs/common";
import { AnalyticsDomainEventBridgeService } from "../modules/analytics/analytics_domain_event_bridge.service";
import { AnalyticsEventPublisher } from "../modules/analytics/analytics_event_publisher";
import { AnalyticsIngestService } from "../modules/analytics/analytics_ingest.service";
import { EventBus } from "../modules/shared/event_bus";

describe("AnalyticsDomainEventBridgeService", () => {
  let eventBus: EventBus;
  let bridge: AnalyticsDomainEventBridgeService;

  afterEach(() => {
    bridge?.onModuleDestroy();
    eventBus?.destroy();
    jest.restoreAllMocks();
  });

  it("bridges upload and release-ready events into the analytics publisher", async () => {
    const publisher: AnalyticsEventPublisher = {
      publish: jest.fn().mockResolvedValue({ published: true, provider: "pubsub", messageId: "msg-1" }),
    };
    const ingest = new AnalyticsIngestService(undefined, publisher);
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    eventBus.publish({
      eventName: "stems.uploaded",
      eventVersion: 1,
      occurredAt: "2026-05-23T10:00:00.000Z",
      releaseId: "rel_917",
      artistId: "artist_917",
      checksum: "completed",
      sourceType: "direct_upload",
      artworkData: Buffer.from("not-for-analytics"),
      metadata: {
        title: "Release Title",
        tracks: [
          {
            id: "track_917",
            title: "Track Title",
            position: 1,
            stems: [
              { id: "stem_original_917", uri: "local://original", type: "original", buffer: Buffer.from("audio") },
            ],
          },
        ],
      },
    } as any);
    eventBus.publish({
      eventName: "catalog.release_ready",
      eventVersion: 1,
      occurredAt: "2026-05-23T10:00:02.000Z",
      releaseId: "rel_917",
      artistId: "artist_917",
      metadata: {
        tracks: [{ id: "track_917", stems: [{ id: "stem_vocals_917" }] }],
      },
    });

    await waitForExpect(() => expect(publisher.publish).toHaveBeenCalledTimes(2));

    const events = await ingest.listEvents();
    expect(events.map((event) => event.eventName)).toEqual(["stems.uploaded", "catalog.release_ready"]);
    expect(events[0]).toEqual(
      expect.objectContaining({
        producer: "ingestion-service",
        privacyTier: "pseudonymous",
        subjectType: "release",
        subjectId: "rel_917",
        actorId: "artist_917",
        payload: expect.objectContaining({
          releaseId: "rel_917",
          artistId: "artist_917",
          sourceType: "direct_upload",
          trackIds: ["track_917"],
          trackCount: 1,
          stemCount: 1,
        }),
      }),
    );
    expect(JSON.stringify(events)).not.toContain("not-for-analytics");
    expect(JSON.stringify(events)).not.toContain("audio");
  });

  it("bridges processed and track-status events with model and status dimensions", async () => {
    const ingest = new AnalyticsIngestService();
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    eventBus.publish({
      eventName: "stems.processed",
      eventVersion: 1,
      occurredAt: "2026-05-23T10:01:00.000Z",
      releaseId: "rel_processed_917",
      artistId: "artist_917",
      modelVersion: "demucs-v4",
      tracks: [
        {
          id: "track_processed_917",
          title: "Processed",
          position: 1,
          stems: [
            { id: "stem_vocals_917", uri: "gs://bucket/vocals.wav", type: "vocals" },
            { id: "stem_drums_917", uri: "gs://bucket/drums.wav", type: "drums" },
          ],
        },
      ],
    });
    eventBus.publish({
      eventName: "catalog.track_status",
      eventVersion: 1,
      occurredAt: "2026-05-23T10:01:01.000Z",
      releaseId: "rel_processed_917",
      trackId: "track_processed_917",
      status: "complete",
    });

    await waitForExpect(async () => expect(await ingest.listEvents()).toHaveLength(2));

    await expect(ingest.listEvents()).resolves.toEqual([
      expect.objectContaining({
        eventName: "stems.processed",
        payload: expect.objectContaining({
          modelVersion: "demucs-v4",
          trackIds: ["track_processed_917"],
          stemIds: ["stem_vocals_917", "stem_drums_917"],
          stemCount: 2,
        }),
      }),
      expect.objectContaining({
        eventName: "catalog.track_status",
        subjectType: "track",
        subjectId: "track_processed_917",
        payload: expect.objectContaining({
          releaseId: "rel_processed_917",
          trackId: "track_processed_917",
          status: "complete",
        }),
      }),
    ]);
  });

  it("bridges high-value domain events with compact analytics payloads", async () => {
    const ingest = new AnalyticsIngestService();
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    const occurredAt = "2026-05-23T11:00:00.000Z";
    const events = [
      {
        eventName: "identity.authenticated",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        role: "listener",
        authMode: "register",
        requestedChainId: 84532,
        verifiedChainId: 84532,
        signupFaucetSent: true,
      },
      {
        eventName: "playlist.created",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        playlistId: "playlist_919",
        folderId: "folder_919",
        trackCount: 0,
        name: "do not persist playlist name",
      },
      {
        eventName: "playlist.track_added",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        playlistId: "playlist_919",
        trackIds: ["track_919"],
        addedCount: 1,
        trackCount: 1,
      },
      {
        eventName: "playlist.updated",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        playlistId: "playlist_919",
        changedFields: ["tracks"],
        trackCount: 1,
        name: "do not persist renamed playlist",
      },
      {
        eventName: "session.started",
        eventVersion: 1,
        occurredAt,
        sessionId: "session_919",
        userId: "user_919",
        budgetCapUsd: 12,
        preferences: { mood: "focus", explicit: false, nested: { drop: true } },
      },
      {
        eventName: "license.granted",
        eventVersion: 1,
        occurredAt,
        licenseId: "lic_919",
        type: "personal",
        priceUsd: 1.25,
        sessionId: "session_919",
        trackId: "track_919",
        artistId: "artist_919",
        title: "Track 919",
      },
      {
        eventName: "artist.remix_consent_updated",
        eventVersion: 1,
        occurredAt,
        artistId: "artist_919",
        userId: "artist_user_919",
        previous: "allowed",
        next: "disabled",
      },
      {
        eventName: "payment.settled",
        eventVersion: 1,
        occurredAt,
        paymentId: "pay_919",
        txHash: "tx_919",
        status: "settled",
        amountUsd: 1.25,
        trackId: "track_919",
        artistId: "artist_919",
        sessionId: "session_919",
        paymentToken: "0x0000000000000000000000000000000000000000",
        settlementAmount: "1250000000000000000",
        settlementAmountUnits: "wei",
      },
      {
        eventName: "contract.stem_sold",
        eventVersion: 1,
        occurredAt,
        listingId: 919n,
        buyerAddress: "0xbuyer",
        amount: 2n,
        totalPaid: 2500000000000000000n,
        chainId: 31337,
        contractAddress: "0xmarket",
        transactionHash: "0xtx919",
        blockNumber: "12",
      },
      {
        eventName: "contract.stake_deposited",
        eventVersion: 1,
        occurredAt,
        tokenId: "101",
        stakerAddress: "0xstaker",
        amount: "1000000000000000000",
        paymentToken: "0xtoken",
        chainId: 31337,
        contractAddress: "0xtrust",
        transactionHash: "0xstake919",
        blockNumber: "13",
      },
      {
        eventName: "agent.purchase_completed",
        eventVersion: 1,
        occurredAt,
        sessionId: "session_919",
        userId: "user_919",
        listingId: "919",
        tokenId: "101",
        amount: "1",
        priceUsd: 1.25,
        txHash: "tx_agent_919",
        mode: "onchain",
      },
      {
        eventName: "agent.track_selected",
        eventVersion: 1,
        occurredAt,
        sessionId: "session_919",
        trackId: "track_919",
        strategy: "recent-first",
        preferences: { secretUserText: "do not persist this" },
      },
      {
        eventName: "generation.started",
        eventVersion: 1,
        occurredAt,
        jobId: "job_919",
        userId: "user_919",
        artistId: "artist_919",
        prompt: "private prompt should not enter analytics",
        durationSeconds: 30,
      },
      {
        eventName: "generation.completed",
        eventVersion: 1,
        occurredAt,
        jobId: "job_919",
        userId: "user_919",
        artistId: "artist_919",
        trackId: "track_generated_919",
        releaseId: "release_generated_919",
      },
      {
        eventName: "recommendation.generated",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        trackIds: ["track_919", "track_alt_919"],
        strategy: "preference_mapping",
      },
      {
        eventName: "community.benefit_redeemed",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        benefitRuleId: "benefit_919",
        benefitType: "discount",
        internalNote: "do not persist benefit note",
      },
      {
        eventName: "community.benefit_rule_created",
        eventVersion: 1,
        occurredAt,
        actorId: "artist_user_919",
        artistId: "artist_919",
        benefitRuleId: "benefit_rule_919",
        benefitType: "room_access",
        status: "active",
        rawEligibilityPolicy: { walletAddress: "do not persist wallet" },
      },
      {
        eventName: "community.badge_granted",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        badgeType: "supporter",
        sourceType: "show_campaign",
        sourceId: "campaign_919",
        campaignId: "campaign_919",
        artistId: "artist_919",
        visibility: "private",
        pledgeAmount: "do not persist pledge amount",
      },
      {
        eventName: "community.role_granted",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        roleType: "supporter",
        scopeType: "show_campaign",
        scopeId: "campaign_919",
        sourceType: "campaign_pledge",
        sourceId: "pledge_919",
        campaignId: "campaign_919",
        artistId: "artist_919",
        visibility: "private",
        walletAddress: "do not persist wallet",
      },
      {
        eventName: "community.artist_tab_enabled",
        eventVersion: 1,
        occurredAt,
        userId: "artist_user_919",
        artistId: "artist_919",
      },
      {
        eventName: "community.room_joined",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        roomId: "room_919",
        roomType: "artist_holder",
        artistId: "artist_919",
      },
      {
        eventName: "community.campaign_room_joined",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        campaignId: "campaign_919",
        campaignSlug: "campaign-slug-919",
        campaignStatus: "active",
        roomId: "campaign_room_919",
        roomType: "show_campaign_supporter",
        artistId: "artist_919",
        city: "Paris",
        country: "FR",
      },
      {
        eventName: "community.show_city_interest_joined",
        eventVersion: 1,
        occurredAt,
        userId: "city_fan_919",
        campaignId: "campaign_919",
        campaignSlug: "campaign-slug-919",
        campaignStatus: "active",
        roomId: "city_room_919",
        roomType: "show_city_demand",
        artistId: "artist_919",
        city: "Paris",
        country: "FR",
        rawLocation: "do not persist raw city source",
      },
      {
        eventName: "community.room_access_denied",
        eventVersion: 1,
        occurredAt,
        userId: "user_locked_919",
        roomId: "room_919",
        roomType: "artist_holder",
        artistId: "artist_919",
        reason: "Holder access is locked for this listener",
        walletHoldings: "do not persist holdings",
      },
      {
        eventName: "community.message_created",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        roomId: "room_919",
        messageId: "message_919",
        messageType: "message",
        artistId: "artist_919",
        body: "do not persist message body",
      },
      {
        eventName: "community.message_created",
        eventVersion: 1,
        occurredAt,
        userId: "artist_user_919",
        roomId: "campaign_room_919",
        messageId: "campaign_update_919",
        messageType: "campaign_update",
        artistId: "artist_919",
        campaignId: "campaign_919",
        campaignSlug: "campaign-slug-919",
        campaignStatus: "active",
        city: "Paris",
        country: "FR",
        body: "do not persist campaign update body",
      },
      {
        eventName: "community.campaign_update_viewed",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        campaignId: "campaign_919",
        campaignSlug: "campaign-slug-919",
        campaignStatus: "active",
        roomId: "campaign_room_919",
        roomType: "show_campaign_supporter",
        artistId: "artist_919",
        latestMessageId: "campaign_update_919",
        visibleUpdateCount: 1,
        city: "Paris",
        country: "FR",
        body: "do not persist viewed update body",
      },
      {
        eventName: "community.message_reported",
        eventVersion: 1,
        occurredAt,
        userId: "user_920",
        roomId: "room_919",
        messageId: "message_919",
        reportId: "report_919",
        reason: "do not persist report reason",
      },
      {
        eventName: "community.message_deleted",
        eventVersion: 1,
        occurredAt,
        userId: "artist_user_919",
        roomId: "room_919",
        messageId: "message_919",
      },
      {
        eventName: "community.member_moderated",
        eventVersion: 1,
        occurredAt,
        userId: "artist_user_919",
        roomId: "room_919",
        targetUserId: "user_920",
        action: "ban",
      },
      {
        eventName: "community.moderation_action_taken",
        eventVersion: 1,
        occurredAt,
        userId: "admin_user_919",
        reportId: "report_919",
        roomId: "room_919",
        messageId: "message_919",
        action: "ban_member",
        outcome: "resolved",
        hasOperatorNote: true,
        operatorNote: "do not persist raw operator note",
      },
      {
        eventName: "community.room_status_updated",
        eventVersion: 1,
        occurredAt,
        userId: "artist_user_919",
        roomId: "room_919",
        status: "paused",
      },
      {
        eventName: "community.discord_bridge_connected",
        eventVersion: 1,
        occurredAt,
        actorId: "artist_user_919",
        artistId: "artist_919",
        publicLinkEnabled: true,
        announcementMirrorEnabled: true,
        roleSyncEnabled: false,
        webhookUrl: "do not persist webhook url",
        inviteUrl: "do not persist invite url",
      },
      {
        eventName: "community.discord_announcement_mirrored",
        eventVersion: 1,
        occurredAt,
        actorId: "artist_user_919",
        artistId: "artist_919",
        roomId: "room_919",
        messageId: "message_919",
        attemptId: "discord_attempt_919",
        status: "completed",
        webhookUrl: "do not persist mirrored webhook url",
        body: "do not persist mirrored announcement body",
      },
      {
        eventName: "community.discord_role_sync_completed",
        eventVersion: 1,
        occurredAt,
        actorId: "artist_user_919",
        artistId: "artist_919",
        mappingCount: 2,
        status: "dry_run",
        reason: "discord_account_linking_required",
        memberIds: ["do not persist member id"],
      },
      {
        eventName: "community.discord_role_sync_failed",
        eventVersion: 1,
        occurredAt,
        actorId: "artist_user_919",
        artistId: "artist_919",
        mappingCount: 1,
        status: "skipped",
        reason: "role_sync_disabled",
        discordUserIds: ["do not persist discord user id"],
      },
      {
        eventName: "community.cohort_suggested",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        cohortId: "cohort_919",
        cohortType: "taste",
        reasonCode: "taste:ambient",
        membershipStatus: "suggested",
        minimumSize: 5,
        visibleMemberCount: 8,
        safeExplanation: "do not persist explanation copy",
      },
      {
        eventName: "wallet.spent",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        amountUsd: 1.25,
        spentUsd: 2.5,
        balanceUsd: 17.5,
      },
      {
        eventName: "wallet.budget_set",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        monthlyCapUsd: 25,
      },
      {
        eventName: "wallet.faucet_requested",
        eventVersion: 1,
        occurredAt,
        userId: "user_919",
        chainId: 84532,
        amountEth: "0.01",
        status: "sent",
      },
      {
        eventName: "x402.purchase",
        eventVersion: 1,
        occurredAt,
        stemId: "stem_919",
        trackId: "track_919",
        releaseId: "rel_919",
        artistId: "artist_919",
        listingId: "919",
        tokenId: "101",
        receiptId: "x402r_919",
        paymentRail: "smart_account",
        transactionHash: "0xx402tx919",
        amountUsd: 0.05,
        canonicalAmountUsd: 0.05,
        paymentToken: "0xusdc",
        paymentAssetId: "x402:usdc",
        paymentAssetSymbol: "USDC",
        paymentAssetDecimals: 6,
        settlementAmount: "50000",
        settlementAmountUnits: "USDC base units",
        settlementStatus: "contract_backed",
        entitlement: "marketplace_purchase",
        paymentProof: "do not persist payment proof",
      },
      {
        eventName: "x402.purchase_failed",
        eventVersion: 1,
        occurredAt,
        stemId: "stem_920",
        listingId: "920",
        receiptId: "x402r_920",
        paymentRail: "smart_account",
        transactionHash: "0xx402tx920",
        status: "contract_failed",
        reason: "marketplace settlement reverted",
        paymentProof: "do not persist failed payment proof",
      },
      {
        eventName: "curator.reported",
        eventVersion: 1,
        occurredAt,
        reportId: "rpt_919",
        curatorId: "curator_919",
        trackId: "track_919",
        reason: "suspected_rights_issue",
      },
      {
        eventName: "remix.created",
        eventVersion: 1,
        occurredAt,
        remixId: "rmx_919",
        creatorId: "creator_919",
        sourceTrackId: "track_919",
        stemIds: ["stem_1", "stem_2"],
        title: "user supplied remix title should not enter analytics",
        txHash: "tx_remix_919",
      },
      {
        eventName: "notification.created",
        eventVersion: 1,
        occurredAt,
        walletAddress: "0xwallet919",
        notificationId: "notif_919",
        type: "dispute_filed",
        title: "do not persist title",
        message: "do not persist body",
        disputeId: "disp_919",
      },
    ];

    for (const event of events) {
      eventBus.publish(event as any);
    }

    await waitForExpect(async () => expect(await ingest.listEvents()).toHaveLength(events.length));

    const analyticsEvents = await ingest.listEvents();
    expect(analyticsEvents.map((event) => event.eventName)).toEqual(events.map((event) => event.eventName));
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "session.started",
        actorId: "user_919",
        sessionId: "session_919",
        payload: expect.objectContaining({
          budgetCapUsd: 12,
          preferences: { mood: "focus", explicit: false },
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "identity.authenticated",
        producer: "auth-service",
        subjectType: "user",
        subjectId: "user_919",
        actorId: "user_919",
        payload: expect.objectContaining({
          role: "listener",
          authMode: "register",
          signupFaucetSent: true,
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "playlist.track_added",
        producer: "playlist-service",
        subjectType: "playlist",
        subjectId: "playlist_919",
        actorId: "user_919",
        payload: expect.objectContaining({
          trackIds: ["track_919"],
          trackCount: 1,
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "payment.settled",
        producer: "payments-service",
        subjectType: "payment",
        subjectId: "pay_919",
        sessionId: "session_919",
        payload: expect.objectContaining({
          paymentId: "pay_919",
          trackId: "track_919",
          artistId: "artist_919",
          canonicalAmountUsd: 1.25,
        }),
        sourceRefs: expect.objectContaining({
          paymentId: "pay_919",
          txHash: "tx_919",
          trackId: "track_919",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "contract.stem_sold",
        subjectId: "919",
        payload: expect.objectContaining({
          listingId: "919",
          amount: "2",
          totalPaid: "2500000000000000000",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "contract.stake_deposited",
        subjectType: "token",
        subjectId: "101",
        actorId: "0xstaker",
        payload: expect.objectContaining({
          amount: "1000000000000000000",
          paymentToken: "0xtoken",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "wallet.budget_set",
        actorId: "user_919",
        payload: expect.objectContaining({
          monthlyCapUsd: 25,
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "wallet.faucet_requested",
        producer: "auth-service",
        actorId: "user_919",
        payload: expect.objectContaining({
          chainId: 84532,
          amountEth: "0.01",
          status: "sent",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.moderation_action_taken",
        producer: "community-service",
        subjectType: "community_moderation_report",
        subjectId: "report_919",
        actorId: "admin_user_919",
        payload: expect.objectContaining({
          reportId: "report_919",
          roomId: "room_919",
          messageId: "message_919",
          action: "ban_member",
          outcome: "resolved",
          hasOperatorNote: true,
        }),
        sourceRefs: expect.objectContaining({
          reportId: "report_919",
          roomId: "room_919",
          messageId: "message_919",
          action: "ban_member",
          outcome: "resolved",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "x402.purchase",
        producer: "x402-controller",
        subjectType: "stem",
        subjectId: "stem_919",
        payload: expect.objectContaining({
          receiptId: "x402r_919",
          paymentRail: "smart_account",
          canonicalAmountUsd: 0.05,
          paymentAssetSymbol: "USDC",
          settlementStatus: "contract_backed",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "recommendation.generated",
        payload: expect.objectContaining({
          trackIds: ["track_919", "track_alt_919"],
          trackCount: 2,
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.room_joined",
        producer: "community-service",
        subjectType: "community_room",
        subjectId: "room_919",
        actorId: "user_919",
        consentBasis: "artist_community_rooms:v1",
        payload: expect.objectContaining({
          roomId: "room_919",
          roomType: "artist_holder",
          artistId: "artist_919",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.room_access_denied",
        subjectId: "room_919",
        actorId: "user_locked_919",
        payload: expect.objectContaining({
          reason: "Holder access is locked for this listener",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.campaign_room_joined",
        producer: "community-service",
        subjectType: "show_campaign",
        subjectId: "campaign_919",
        actorId: "user_919",
        consentBasis: "show_campaign_community:v1",
        payload: expect.objectContaining({
          campaignId: "campaign_919",
          campaignSlug: "campaign-slug-919",
          campaignStatus: "active",
          roomId: "campaign_room_919",
          roomType: "show_campaign_supporter",
          city: "Paris",
          country: "FR",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.show_city_interest_joined",
        producer: "community-service",
        subjectType: "show_campaign",
        subjectId: "campaign_919",
        actorId: "city_fan_919",
        consentBasis: "show_city_demand:v1",
        payload: expect.objectContaining({
          campaignId: "campaign_919",
          campaignSlug: "campaign-slug-919",
          campaignStatus: "active",
          roomId: "city_room_919",
          roomType: "show_city_demand",
          city: "Paris",
          country: "FR",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "artist.remix_consent_updated",
        subjectType: "artist",
        subjectId: "artist_919",
        actorId: "artist_user_919",
        payload: expect.objectContaining({
          artistId: "artist_919",
          previous: "allowed",
          next: "disabled",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.message_created",
        subjectType: "community_message",
        subjectId: "message_919",
        payload: expect.objectContaining({
          roomId: "room_919",
          messageId: "message_919",
          messageType: "message",
          artistId: "artist_919",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.message_created",
        subjectType: "community_message",
        subjectId: "campaign_update_919",
        payload: expect.objectContaining({
          roomId: "campaign_room_919",
          messageId: "campaign_update_919",
          messageType: "campaign_update",
          artistId: "artist_919",
          campaignId: "campaign_919",
          campaignSlug: "campaign-slug-919",
          campaignStatus: "active",
          city: "Paris",
          country: "FR",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.discord_bridge_connected",
        producer: "community-service",
        subjectType: "artist",
        subjectId: "artist_919",
        actorId: "artist_user_919",
        consentBasis: "artist_discord_bridge:v1",
        payload: expect.objectContaining({
          artistId: "artist_919",
          publicLinkEnabled: true,
          announcementMirrorEnabled: true,
          roleSyncEnabled: false,
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.discord_announcement_mirrored",
        subjectType: "community_message",
        subjectId: "message_919",
        actorId: "artist_user_919",
        consentBasis: "artist_discord_bridge:v1",
        payload: expect.objectContaining({
          artistId: "artist_919",
          roomId: "room_919",
          messageId: "message_919",
          attemptId: "discord_attempt_919",
          status: "completed",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.discord_role_sync_completed",
        subjectType: "artist",
        subjectId: "artist_919",
        actorId: "artist_user_919",
        payload: expect.objectContaining({
          artistId: "artist_919",
          mappingCount: 2,
          status: "dry_run",
          reason: "discord_account_linking_required",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.discord_role_sync_failed",
        subjectType: "artist",
        subjectId: "artist_919",
        actorId: "artist_user_919",
        payload: expect.objectContaining({
          artistId: "artist_919",
          mappingCount: 1,
          status: "skipped",
          reason: "role_sync_disabled",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.campaign_update_viewed",
        subjectType: "show_campaign",
        subjectId: "campaign_919",
        actorId: "user_919",
        consentBasis: "show_campaign_community:v1",
        payload: expect.objectContaining({
          campaignId: "campaign_919",
          campaignSlug: "campaign-slug-919",
          campaignStatus: "active",
          roomId: "campaign_room_919",
          roomType: "show_campaign_supporter",
          latestMessageId: "campaign_update_919",
          visibleUpdateCount: 1,
          city: "Paris",
          country: "FR",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.cohort_suggested",
        subjectType: "community_cohort",
        subjectId: "cohort_919",
        actorId: "user_919",
        consentBasis: "community_cohort_matching:v1",
        payload: expect.objectContaining({
          cohortId: "cohort_919",
          cohortType: "taste",
          reasonCode: "taste:ambient",
          membershipStatus: "suggested",
          minimumSize: 5,
          visibleMemberCount: 8,
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.benefit_redeemed",
        subjectType: "community_benefit",
        subjectId: "benefit_919",
        payload: expect.objectContaining({
          benefitRuleId: "benefit_919",
          benefitType: "discount",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.benefit_rule_created",
        subjectType: "community_benefit_rule",
        subjectId: "benefit_rule_919",
        actorId: "artist_user_919",
        consentBasis: "community_benefit_rule_management:v1",
        payload: expect.objectContaining({
          artistId: "artist_919",
          benefitRuleId: "benefit_rule_919",
          benefitType: "room_access",
          status: "active",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.badge_granted",
        subjectType: "community_badge",
        subjectId: "campaign_919",
        payload: expect.objectContaining({
          badgeType: "supporter",
          sourceType: "show_campaign",
          sourceId: "campaign_919",
          campaignId: "campaign_919",
          artistId: "artist_919",
          visibility: "private",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "community.role_granted",
        subjectType: "community_role",
        subjectId: "campaign_919",
        payload: expect.objectContaining({
          roleType: "supporter",
          scopeType: "show_campaign",
          scopeId: "campaign_919",
          sourceType: "campaign_pledge",
          sourceId: "pledge_919",
          campaignId: "campaign_919",
          artistId: "artist_919",
          visibility: "private",
        }),
      }),
    );
    expect(analyticsEvents).toContainEqual(
      expect.objectContaining({
        eventName: "remix.created",
        payload: expect.objectContaining({
          stemIds: ["stem_1", "stem_2"],
          stemCount: 2,
        }),
      }),
    );
    const serializedEvents = JSON.stringify(analyticsEvents);
    expect(serializedEvents).not.toContain("private prompt");
    expect(serializedEvents).not.toContain("secretUserText");
    expect(serializedEvents).not.toContain("do not persist title");
    expect(serializedEvents).not.toContain("do not persist body");
    expect(serializedEvents).not.toContain("user supplied remix title");
    expect(serializedEvents).not.toContain("do not persist playlist name");
    expect(serializedEvents).not.toContain("do not persist renamed playlist");
    expect(serializedEvents).not.toContain("do not persist payment proof");
    expect(serializedEvents).not.toContain("do not persist failed payment proof");
    expect(serializedEvents).not.toContain("do not persist benefit note");
    expect(serializedEvents).not.toContain("do not persist pledge amount");
    expect(serializedEvents).not.toContain("do not persist wallet");
    expect(serializedEvents).not.toContain("do not persist holdings");
    expect(serializedEvents).not.toContain("do not persist message body");
    expect(serializedEvents).not.toContain("do not persist campaign update body");
    expect(serializedEvents).not.toContain("do not persist viewed update body");
    expect(serializedEvents).not.toContain("do not persist raw city source");
    expect(serializedEvents).not.toContain("do not persist report reason");
    expect(serializedEvents).not.toContain("do not persist webhook url");
    expect(serializedEvents).not.toContain("do not persist invite url");
    expect(serializedEvents).not.toContain("do not persist mirrored webhook url");
    expect(serializedEvents).not.toContain("do not persist mirrored announcement body");
    expect(serializedEvents).not.toContain("do not persist member id");
    expect(serializedEvents).not.toContain("do not persist discord user id");
  });

  it("does not throw domain publishing when analytics ingest fails", async () => {
    jest.spyOn(Logger.prototype, "warn").mockImplementation(() => undefined);
    const ingest = {
      ingest: jest.fn().mockRejectedValue(new Error("analytics unavailable")),
    } as unknown as AnalyticsIngestService;
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    expect(() =>
      eventBus.publish({
        eventName: "catalog.track_status",
        eventVersion: 1,
        occurredAt: "2026-05-23T10:02:00.000Z",
        releaseId: "rel_non_blocking_917",
        trackId: "track_non_blocking_917",
        status: "failed",
        error: "analytics should not block catalog",
      }),
    ).not.toThrow();

    await waitForExpect(() => expect(ingest.ingest).toHaveBeenCalledTimes(1));
  });

  it("bridges show campaign settlement fee fields", async () => {
    const ingest = new AnalyticsIngestService();
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    eventBus.publish({
      eventName: "shows.campaign_settled",
      eventVersion: 1,
      occurredAt: "2026-07-04T10:00:00.000Z",
      campaignId: "campaign_fee_1",
      campaignSlug: "campaign-fee-1",
      artistId: "artist_fee_1",
      contractCampaignId: "7",
      settlementStage: "final",
      grossAmountUnits: "1000",
      feeAmountUnits: "60",
      netAmountUnits: "940",
      feeBps: 600,
      totalFeePaidUnits: "60",
      paymentAssetSymbol: "USDC",
      paymentAssetDecimals: 6,
      paymentToken: "0x1111111111111111111111111111111111111111",
      chainId: 31337,
      contractAddress: "0x2222222222222222222222222222222222222222",
      transactionHash: "0x" + "33".repeat(32),
      blockNumber: "123",
    });

    await waitForExpect(async () => expect(await ingest.listEvents()).toHaveLength(1));
    const [event] = await ingest.listEvents();
    expect(event).toEqual(expect.objectContaining({
      eventName: "shows.campaign_settled",
      producer: "shows-escrow-indexer",
      subjectType: "show_campaign",
      subjectId: "campaign_fee_1",
      actorId: "artist_fee_1",
      payload: expect.objectContaining({
        grossAmountUnits: "1000",
        feeAmountUnits: "60",
        netAmountUnits: "940",
        feeBps: 600,
        totalFeePaidUnits: "60",
      }),
    }));
  });

  // #1271: the reconciliation-mismatch bridge entry is the durable record the
  // operator endpoint (GET /shows/operator/reconciliation-mismatches) and the
  // staging drift drill read back. This publishes EXACTLY what the indexer's
  // emitMismatch() publishes (contractCampaignId is the STRING coercion of the
  // on-chain uint — `String(args.campaignId)`; blockNumber is a string) and
  // asserts the ingested envelope: eventName, subjectType, and — load-bearing —
  // subjectId equal to that contractCampaignId string, because the operator
  // endpoint filters on subjectId. A config typo or subjectIdKeys mistake fails
  // here instead of only live on staging.
  it("bridges reconciliation mismatches with contractCampaignId as the subject", async () => {
    const ingest = new AnalyticsIngestService();
    eventBus = new EventBus();
    bridge = new AnalyticsDomainEventBridgeService(eventBus, ingest);
    bridge.onModuleInit();

    const transactionHash = "0x" + "44".repeat(32);
    eventBus.publish({
      eventName: "shows.campaign_reconciliation_mismatch",
      eventVersion: 1,
      occurredAt: "2026-07-13T10:00:00.000Z",
      // emitMismatch publishes String(args.campaignId) — the string coercion of
      // the numeric on-chain campaign id.
      contractCampaignId: String(42),
      escrowEventName: "Pledged",
      transactionHash,
      blockNumber: "4567",
      reason:
        "on-chain pledge from 0x70997970c51812dc3a010c7d01b50e0d17dc79c8 (1000000) has no matching backend intent",
    });

    await waitForExpect(async () => expect(await ingest.listEvents()).toHaveLength(1));
    const [event] = await ingest.listEvents();
    expect(event).toEqual(expect.objectContaining({
      eventName: "shows.campaign_reconciliation_mismatch",
      producer: "shows-escrow-indexer",
      subjectType: "show_campaign",
      // Load-bearing: the operator endpoint filters analyticsEvent rows on
      // subjectId === contractCampaignId (string).
      subjectId: "42",
      payload: expect.objectContaining({
        contractCampaignId: "42",
        escrowEventName: "Pledged",
        transactionHash,
        blockNumber: "4567",
        reason: expect.stringContaining("no matching backend intent"),
      }),
    }));
    expect(event.sourceRefs).toEqual(expect.objectContaining({
      contractCampaignId: "42",
      transactionHash,
      blockNumber: "4567",
    }));
  });
});

async function waitForExpect(assertion: () => void | Promise<void>) {
  let lastError: unknown;
  for (let attempt = 0; attempt < 20; attempt++) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
  }
  throw lastError;
}
