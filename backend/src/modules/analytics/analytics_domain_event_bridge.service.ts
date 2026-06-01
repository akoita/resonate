import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from "@nestjs/common";
import { Subscription } from "rxjs";
import {
  CatalogReleaseReadyEvent,
  CatalogTrackStatusEvent,
  StemsFailedEvent,
  StemsProcessedEvent,
  StemsUploadedEvent,
  ResonateEvent,
} from "../../events/event_types";
import { EventBus } from "../shared/event_bus";
import { AnalyticsEventInput } from "./analytics_event";
import { AnalyticsIngestService } from "./analytics_ingest.service";

type ResonateDomainEvent = {
  eventName: string;
  eventVersion?: number;
  occurredAt?: string;
  [key: string]: unknown;
};

type DomainBridgeConfig = {
  eventName: ResonateEvent["eventName"];
  producer: string;
  subjectType?: string;
  subjectIdKeys?: readonly string[];
  actorIdKeys?: readonly string[];
  sessionIdKeys?: readonly string[];
  consentBasis?: string;
  payloadKeys: readonly string[];
  sourceRefKeys: readonly string[];
};

const HIGH_VALUE_DOMAIN_EVENT_BRIDGES: readonly DomainBridgeConfig[] = [
  {
    eventName: "identity.authenticated",
    producer: "auth-service",
    subjectType: "user",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["userId", "role", "authMode", "requestedChainId", "verifiedChainId", "signupFaucetSent"],
    sourceRefKeys: ["userId", "authMode", "verifiedChainId"],
  },
  {
    eventName: "playlist.created",
    producer: "playlist-service",
    subjectType: "playlist",
    subjectIdKeys: ["playlistId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["playlistId", "userId", "folderId", "trackCount"],
    sourceRefKeys: ["playlistId", "userId", "folderId"],
  },
  {
    eventName: "playlist.updated",
    producer: "playlist-service",
    subjectType: "playlist",
    subjectIdKeys: ["playlistId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["playlistId", "userId", "folderId", "changedFields", "trackCount"],
    sourceRefKeys: ["playlistId", "userId", "folderId"],
  },
  {
    eventName: "playlist.deleted",
    producer: "playlist-service",
    subjectType: "playlist",
    subjectIdKeys: ["playlistId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["playlistId", "userId", "trackCount"],
    sourceRefKeys: ["playlistId", "userId"],
  },
  {
    eventName: "playlist.track_added",
    producer: "playlist-service",
    subjectType: "playlist",
    subjectIdKeys: ["playlistId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["playlistId", "userId", "trackIds", "addedCount", "trackCount"],
    sourceRefKeys: ["playlistId", "userId"],
  },
  {
    eventName: "playlist.track_removed",
    producer: "playlist-service",
    subjectType: "playlist",
    subjectIdKeys: ["playlistId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["playlistId", "userId", "trackIds", "removedCount", "trackCount"],
    sourceRefKeys: ["playlistId", "userId"],
  },
  {
    eventName: "session.started",
    producer: "sessions-service",
    subjectType: "session",
    subjectIdKeys: ["sessionId"],
    actorIdKeys: ["userId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "userId", "budgetCapUsd", "preferences"],
    sourceRefKeys: ["sessionId", "userId"],
  },
  {
    eventName: "taste_memory.settings_updated",
    producer: "taste-memory-service",
    subjectType: "taste_memory",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    consentBasis: "taste_memory_controls:v1",
    payloadKeys: ["settings"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "taste_memory.signal_hidden",
    producer: "taste-memory-service",
    subjectType: "taste_signal",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    consentBasis: "taste_memory_controls:v1",
    payloadKeys: ["signalType", "value", "action"],
    sourceRefKeys: ["userId", "signalType", "action"],
  },
  {
    eventName: "taste_memory.signal_downranked",
    producer: "taste-memory-service",
    subjectType: "taste_signal",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    consentBasis: "taste_memory_controls:v1",
    payloadKeys: ["signalType", "value", "action"],
    sourceRefKeys: ["userId", "signalType", "action"],
  },
  {
    eventName: "taste_memory.signal_restored",
    producer: "taste-memory-service",
    subjectType: "taste_signal",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    consentBasis: "taste_memory_controls:v1",
    payloadKeys: ["signalType", "value", "action"],
    sourceRefKeys: ["userId", "signalType", "action"],
  },
  {
    eventName: "taste_memory.reset",
    producer: "taste-memory-service",
    subjectType: "taste_memory",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    consentBasis: "taste_memory_controls:v1",
    payloadKeys: ["resetAt"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "community.profile_visibility_updated",
    producer: "community-service",
    subjectType: "community_profile",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    consentBasis: "community_profile_visibility:v1",
    payloadKeys: ["profileVisibility"],
    sourceRefKeys: ["userId", "profileVisibility"],
  },
  {
    eventName: "community.profile_showcase_updated",
    producer: "community-service",
    subjectType: "community_profile",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    consentBasis: "community_profile_visibility:v1",
    payloadKeys: ["changedFields"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "community.ownership_display_updated",
    producer: "community-service",
    subjectType: "community_profile",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    consentBasis: "community_profile_visibility:v1",
    payloadKeys: ["showWalletAddress", "showOwnedItems"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "community.benefit_redeemed",
    producer: "community-service",
    subjectType: "community_benefit",
    subjectIdKeys: ["benefitRuleId"],
    actorIdKeys: ["userId"],
    consentBasis: "community_benefits:v1",
    payloadKeys: ["benefitRuleId", "benefitType"],
    sourceRefKeys: ["benefitRuleId", "benefitType"],
  },
  {
    eventName: "community.artist_tab_enabled",
    producer: "community-service",
    subjectType: "artist",
    subjectIdKeys: ["artistId"],
    actorIdKeys: ["userId"],
    consentBasis: "artist_community_rooms:v1",
    payloadKeys: ["artistId"],
    sourceRefKeys: ["artistId"],
  },
  {
    eventName: "community.room_joined",
    producer: "community-service",
    subjectType: "community_room",
    subjectIdKeys: ["roomId"],
    actorIdKeys: ["userId"],
    consentBasis: "artist_community_rooms:v1",
    payloadKeys: ["roomId", "roomType", "artistId", "campaignId"],
    sourceRefKeys: ["roomId", "roomType", "artistId", "campaignId"],
  },
  {
    eventName: "community.campaign_room_joined",
    producer: "community-service",
    subjectType: "show_campaign",
    subjectIdKeys: ["campaignId"],
    actorIdKeys: ["userId"],
    consentBasis: "show_campaign_community:v1",
    payloadKeys: ["campaignId", "roomId", "roomType", "artistId"],
    sourceRefKeys: ["campaignId", "roomId", "roomType", "artistId"],
  },
  {
    eventName: "community.show_city_interest_joined",
    producer: "community-service",
    subjectType: "show_campaign",
    subjectIdKeys: ["campaignId"],
    actorIdKeys: ["userId"],
    consentBasis: "show_city_demand:v1",
    payloadKeys: ["campaignId", "campaignSlug", "roomId", "roomType", "artistId", "city", "country"],
    sourceRefKeys: ["campaignId", "campaignSlug", "roomId", "roomType", "artistId", "city", "country"],
  },
  {
    eventName: "community.room_left",
    producer: "community-service",
    subjectType: "community_room",
    subjectIdKeys: ["roomId"],
    actorIdKeys: ["userId"],
    consentBasis: "artist_community_rooms:v1",
    payloadKeys: ["roomId", "roomType", "artistId", "campaignId"],
    sourceRefKeys: ["roomId", "roomType", "artistId", "campaignId"],
  },
  {
    eventName: "community.room_access_denied",
    producer: "community-service",
    subjectType: "community_room",
    subjectIdKeys: ["roomId"],
    actorIdKeys: ["userId"],
    consentBasis: "artist_community_rooms:v1",
    payloadKeys: ["roomId", "roomType", "artistId", "campaignId", "reason"],
    sourceRefKeys: ["roomId", "roomType", "artistId", "campaignId", "reason"],
  },
  {
    eventName: "community.message_created",
    producer: "community-service",
    subjectType: "community_message",
    subjectIdKeys: ["messageId"],
    actorIdKeys: ["userId"],
    consentBasis: "community_messages:v1",
    payloadKeys: ["roomId", "messageId", "messageType", "campaignId", "campaignSlug"],
    sourceRefKeys: ["roomId", "messageId", "messageType", "campaignId", "campaignSlug"],
  },
  {
    eventName: "community.message_reported",
    producer: "community-service",
    subjectType: "community_message",
    subjectIdKeys: ["messageId"],
    actorIdKeys: ["userId"],
    consentBasis: "artist_community_rooms:v1",
    payloadKeys: ["roomId", "messageId", "reportId", "campaignId"],
    sourceRefKeys: ["roomId", "messageId", "reportId", "campaignId"],
  },
  {
    eventName: "community.message_deleted",
    producer: "community-service",
    subjectType: "community_message",
    subjectIdKeys: ["messageId"],
    actorIdKeys: ["userId"],
    consentBasis: "artist_community_rooms:v1",
    payloadKeys: ["roomId", "messageId", "campaignId"],
    sourceRefKeys: ["roomId", "messageId", "campaignId"],
  },
  {
    eventName: "community.member_moderated",
    producer: "community-service",
    subjectType: "community_room",
    subjectIdKeys: ["roomId"],
    actorIdKeys: ["userId"],
    consentBasis: "artist_community_rooms:v1",
    payloadKeys: ["roomId", "targetUserId", "action"],
    sourceRefKeys: ["roomId", "targetUserId", "action"],
  },
  {
    eventName: "community.room_status_updated",
    producer: "community-service",
    subjectType: "community_room",
    subjectIdKeys: ["roomId"],
    actorIdKeys: ["userId"],
    consentBasis: "artist_community_rooms:v1",
    payloadKeys: ["roomId", "status"],
    sourceRefKeys: ["roomId", "status"],
  },
  {
    eventName: "session.ended",
    producer: "sessions-service",
    subjectType: "session",
    subjectIdKeys: ["sessionId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "spentTotalUsd", "reason"],
    sourceRefKeys: ["sessionId", "reason"],
  },
  {
    eventName: "license.granted",
    producer: "sessions-service",
    subjectType: "license",
    subjectIdKeys: ["licenseId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["licenseId", "type", "priceUsd", "trackId", "artistId", "releaseId", "sessionId", "title"],
    sourceRefKeys: ["licenseId", "trackId", "artistId", "releaseId", "sessionId"],
  },
  {
    eventName: "payment.initiated",
    producer: "payments-service",
    subjectType: "payment",
    subjectIdKeys: ["paymentId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: [
      "paymentId",
      "amountUsd",
      "trackId",
      "artistId",
      "releaseId",
      "title",
      "sessionId",
      "chainId",
      "paymentToken",
      "paymentAssetId",
      "paymentAssetSymbol",
      "paymentAssetDecimals",
      "settlementAmount",
      "settlementAmountUnits",
    ],
    sourceRefKeys: ["paymentId", "trackId", "artistId", "releaseId", "sessionId", "chainId"],
  },
  {
    eventName: "payment.settled",
    producer: "payments-service",
    subjectType: "payment",
    subjectIdKeys: ["paymentId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: [
      "paymentId",
      "txHash",
      "status",
      "amountUsd",
      "trackId",
      "artistId",
      "releaseId",
      "title",
      "sessionId",
      "chainId",
      "paymentToken",
      "paymentAssetId",
      "paymentAssetSymbol",
      "paymentAssetDecimals",
      "settlementAmount",
      "settlementAmountUnits",
    ],
    sourceRefKeys: ["paymentId", "txHash", "trackId", "artistId", "releaseId", "sessionId", "chainId"],
  },
  {
    eventName: "contract.stem_listed",
    producer: "contracts-indexer",
    subjectType: "listing",
    subjectIdKeys: ["listingId"],
    actorIdKeys: ["sellerAddress"],
    payloadKeys: [
      "listingId",
      "sellerAddress",
      "tokenId",
      "amount",
      "pricePerUnit",
      "paymentToken",
      "expiresAt",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["listingId", "tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.stem_sold",
    producer: "contracts-indexer",
    subjectType: "listing",
    subjectIdKeys: ["listingId"],
    actorIdKeys: ["buyerAddress"],
    payloadKeys: [
      "listingId",
      "buyerAddress",
      "amount",
      "totalPaid",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["listingId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.stem_minted",
    producer: "contracts-indexer",
    subjectType: "token",
    subjectIdKeys: ["tokenId"],
    actorIdKeys: ["creatorAddress"],
    payloadKeys: [
      "tokenId",
      "creatorAddress",
      "parentIds",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.listing_cancelled",
    producer: "contracts-indexer",
    subjectType: "listing",
    subjectIdKeys: ["listingId"],
    payloadKeys: ["listingId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
    sourceRefKeys: ["listingId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.royalty_paid",
    producer: "contracts-indexer",
    subjectType: "token",
    subjectIdKeys: ["tokenId"],
    actorIdKeys: ["recipientAddress"],
    payloadKeys: [
      "tokenId",
      "recipientAddress",
      "amount",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.content_attested",
    producer: "contracts-indexer",
    subjectType: "token",
    subjectIdKeys: ["tokenId"],
    actorIdKeys: ["attesterAddress"],
    payloadKeys: [
      "tokenId",
      "attesterAddress",
      "contentHash",
      "fingerprintHash",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.stake_deposited",
    producer: "contracts-indexer",
    subjectType: "token",
    subjectIdKeys: ["tokenId"],
    actorIdKeys: ["stakerAddress"],
    payloadKeys: [
      "tokenId",
      "stakerAddress",
      "amount",
      "paymentToken",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.stake_slashed",
    producer: "contracts-indexer",
    subjectType: "token",
    subjectIdKeys: ["tokenId"],
    actorIdKeys: ["reporterAddress"],
    payloadKeys: [
      "tokenId",
      "reporterAddress",
      "paymentToken",
      "reporterAmount",
      "treasuryAmount",
      "burnedAmount",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.escrow_released",
    producer: "contracts-indexer",
    subjectType: "token",
    subjectIdKeys: ["tokenId"],
    actorIdKeys: ["beneficiaryAddress"],
    payloadKeys: [
      "tokenId",
      "beneficiaryAddress",
      "amount",
      "paymentToken",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.escrow_frozen",
    producer: "contracts-indexer",
    subjectType: "token",
    subjectIdKeys: ["tokenId"],
    payloadKeys: ["tokenId", "paymentToken", "chainId", "contractAddress", "transactionHash", "blockNumber"],
    sourceRefKeys: ["tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.escrow_redirected",
    producer: "contracts-indexer",
    subjectType: "token",
    subjectIdKeys: ["tokenId"],
    actorIdKeys: ["newRecipient"],
    payloadKeys: [
      "tokenId",
      "newRecipient",
      "amount",
      "paymentToken",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.address_blacklisted",
    producer: "contracts-indexer",
    subjectType: "address",
    subjectIdKeys: ["account"],
    actorIdKeys: ["account"],
    payloadKeys: ["account", "chainId", "contractAddress", "transactionHash", "blockNumber"],
    sourceRefKeys: ["account", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "agent.purchase_completed",
    producer: "agent-purchase-service",
    subjectType: "listing",
    subjectIdKeys: ["listingId"],
    actorIdKeys: ["userId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "userId", "listingId", "tokenId", "amount", "priceUsd", "txHash", "mode"],
    sourceRefKeys: ["sessionId", "userId", "listingId", "tokenId", "txHash"],
  },
  {
    eventName: "agent.purchase_failed",
    producer: "agent-purchase-service",
    subjectType: "listing",
    subjectIdKeys: ["listingId"],
    actorIdKeys: ["userId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "userId", "listingId", "tokenId", "amount", "priceUsd", "error"],
    sourceRefKeys: ["sessionId", "userId", "listingId", "tokenId"],
  },
  {
    eventName: "agent.track_selected",
    producer: "agent-runtime",
    subjectType: "track",
    subjectIdKeys: ["trackId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "trackId", "artistId", "releaseId", "strategy", "source"],
    sourceRefKeys: ["sessionId", "trackId", "artistId", "releaseId"],
  },
  {
    eventName: "agent.evaluated",
    producer: "agent-runtime",
    subjectType: "track",
    subjectIdKeys: ["trackId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "trackId", "licenseType", "priceUsd", "reason"],
    sourceRefKeys: ["sessionId", "trackId", "licenseType"],
  },
  {
    eventName: "agent.selection",
    producer: "agent-runtime",
    subjectType: "track",
    subjectIdKeys: ["trackId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "trackId", "candidates", "count", "strategy"],
    sourceRefKeys: ["sessionId", "trackId", "strategy"],
  },
  {
    eventName: "agent.mix_planned",
    producer: "agent-runtime",
    subjectType: "track",
    subjectIdKeys: ["trackId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "trackId", "trackTitle", "transition"],
    sourceRefKeys: ["sessionId", "trackId", "transition"],
  },
  {
    eventName: "agent.negotiated",
    producer: "agent-runtime",
    subjectType: "track",
    subjectIdKeys: ["trackId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "trackId", "trackTitle", "licenseType", "priceUsd", "reason"],
    sourceRefKeys: ["sessionId", "trackId", "licenseType"],
  },
  {
    eventName: "agent.evaluation_completed",
    producer: "agent-runtime",
    payloadKeys: ["total", "approved", "rejected", "approvalRate", "avgPriceUsd", "repeatRate"],
    sourceRefKeys: ["total", "approved", "rejected"],
  },
  {
    eventName: "agent.decision_made",
    producer: "agent-runtime",
    subjectType: "track",
    subjectIdKeys: ["trackId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "trackId", "artistId", "releaseId", "licenseType", "priceUsd", "reason"],
    sourceRefKeys: ["sessionId", "trackId", "artistId", "releaseId"],
  },
  {
    eventName: "agent.generation_triggered",
    producer: "agent-runtime",
    subjectType: "generation_job",
    subjectIdKeys: ["jobId"],
    sessionIdKeys: ["sessionId"],
    payloadKeys: ["sessionId", "jobId", "costUsd", "reason"],
    sourceRefKeys: ["sessionId", "jobId"],
  },
  {
    eventName: "agent.wallet_enabled",
    producer: "agent-wallet-service",
    subjectType: "user_wallet",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["userId", "walletAddress", "agentAddress"],
    sourceRefKeys: ["userId", "walletAddress", "agentAddress"],
  },
  {
    eventName: "agent.wallet_disabled",
    producer: "agent-wallet-service",
    subjectType: "user_wallet",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["userId"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "agent.budget_alert",
    producer: "agent-wallet-service",
    subjectType: "user_wallet",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["userId", "level", "percentUsed", "spentUsd", "monthlyCapUsd", "remainingUsd"],
    sourceRefKeys: ["userId", "level"],
  },
  {
    eventName: "generation.started",
    producer: "generation-service",
    subjectType: "generation_job",
    subjectIdKeys: ["jobId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["jobId", "userId", "artistId", "durationSeconds", "seed"],
    sourceRefKeys: ["jobId", "userId", "artistId"],
  },
  {
    eventName: "generation.completed",
    producer: "generation-service",
    subjectType: "generation_job",
    subjectIdKeys: ["jobId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["jobId", "userId", "artistId", "trackId", "releaseId", "durationSeconds", "provider", "model"],
    sourceRefKeys: ["jobId", "userId", "artistId", "trackId", "releaseId"],
  },
  {
    eventName: "generation.failed",
    producer: "generation-service",
    subjectType: "generation_job",
    subjectIdKeys: ["jobId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["jobId", "userId", "artistId", "error"],
    sourceRefKeys: ["jobId", "userId", "artistId"],
  },
  {
    eventName: "generation.progress",
    producer: "generation-service",
    subjectType: "generation_job",
    subjectIdKeys: ["jobId"],
    payloadKeys: ["jobId", "phase"],
    sourceRefKeys: ["jobId", "phase"],
  },
  {
    eventName: "recommendation.generated",
    producer: "recommendations-service",
    actorIdKeys: ["userId"],
    payloadKeys: ["userId", "trackIds", "strategy"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "recommendation.preferences_updated",
    producer: "recommendations-service",
    actorIdKeys: ["userId"],
    payloadKeys: ["userId", "preferences"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "wallet.funded",
    producer: "wallet-service",
    subjectType: "user_wallet",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["userId", "amountUsd", "balanceUsd"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "wallet.spent",
    producer: "wallet-service",
    subjectType: "user_wallet",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["userId", "amountUsd", "spentUsd", "balanceUsd"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "wallet.budget_set",
    producer: "wallet-service",
    subjectType: "user_wallet",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["userId", "monthlyCapUsd"],
    sourceRefKeys: ["userId"],
  },
  {
    eventName: "wallet.faucet_requested",
    producer: "auth-service",
    subjectType: "user_wallet",
    subjectIdKeys: ["userId"],
    actorIdKeys: ["userId"],
    payloadKeys: ["userId", "chainId", "amountEth", "status"],
    sourceRefKeys: ["userId", "chainId", "status"],
  },
  {
    eventName: "x402.purchase",
    producer: "x402-controller",
    subjectType: "stem",
    subjectIdKeys: ["stemId"],
    actorIdKeys: ["payer"],
    payloadKeys: [
      "stemId",
      "trackId",
      "releaseId",
      "artistId",
      "listingId",
      "tokenId",
      "receiptId",
      "paymentRail",
      "transactionHash",
      "amountUsd",
      "canonicalAmountUsd",
      "paymentToken",
      "paymentAssetId",
      "paymentAssetSymbol",
      "paymentAssetDecimals",
      "settlementAmount",
      "settlementAmountUnits",
      "settlementStatus",
      "entitlement",
    ],
    sourceRefKeys: ["stemId", "trackId", "releaseId", "artistId", "listingId", "receiptId", "transactionHash"],
  },
  {
    eventName: "x402.purchase_failed",
    producer: "x402-controller",
    subjectType: "stem",
    subjectIdKeys: ["stemId"],
    payloadKeys: [
      "stemId",
      "trackId",
      "releaseId",
      "artistId",
      "listingId",
      "receiptId",
      "paymentRail",
      "transactionHash",
      "status",
      "reason",
    ],
    sourceRefKeys: ["stemId", "trackId", "releaseId", "artistId", "listingId", "receiptId", "transactionHash"],
  },
  {
    eventName: "curator.staked",
    producer: "curation-service",
    subjectType: "curator",
    subjectIdKeys: ["curatorId"],
    actorIdKeys: ["curatorId"],
    payloadKeys: ["curatorId", "amountUsd"],
    sourceRefKeys: ["curatorId"],
  },
  {
    eventName: "curator.reported",
    producer: "curation-service",
    subjectType: "report",
    subjectIdKeys: ["reportId"],
    actorIdKeys: ["curatorId"],
    payloadKeys: ["reportId", "curatorId", "trackId", "reason"],
    sourceRefKeys: ["reportId", "curatorId", "trackId"],
  },
  {
    eventName: "remix.created",
    producer: "remix-service",
    subjectType: "remix",
    subjectIdKeys: ["remixId"],
    actorIdKeys: ["creatorId"],
    payloadKeys: ["remixId", "creatorId", "sourceTrackId", "stemIds", "txHash"],
    sourceRefKeys: ["remixId", "creatorId", "sourceTrackId", "txHash"],
  },
  {
    eventName: "release_rights.request_updated",
    producer: "rights-service",
    subjectType: "release_rights_request",
    subjectIdKeys: ["requestId"],
    payloadKeys: ["requestId", "releaseId", "status"],
    sourceRefKeys: ["requestId", "releaseId", "status"],
  },
  {
    eventName: "marketplace.listing_notify",
    producer: "marketplace-service",
    subjectType: "listing",
    subjectIdKeys: ["listingId"],
    actorIdKeys: ["sellerAddress"],
    payloadKeys: [
      "listingId",
      "tokenId",
      "sellerAddress",
      "amount",
      "pricePerUnit",
      "paymentToken",
      "licenseType",
      "stemId",
      "transactionHash",
    ],
    sourceRefKeys: ["listingId", "tokenId", "sellerAddress", "stemId", "transactionHash"],
  },
  {
    eventName: "notification.created",
    producer: "notification-service",
    subjectType: "notification",
    subjectIdKeys: ["notificationId"],
    actorIdKeys: ["walletAddress"],
    payloadKeys: ["notificationId", "walletAddress", "type", "disputeId", "releaseId"],
    sourceRefKeys: ["notificationId", "walletAddress", "disputeId", "releaseId"],
  },
  {
    eventName: "contract.dispute_filed",
    producer: "contracts-indexer",
    subjectType: "dispute",
    subjectIdKeys: ["disputeId"],
    actorIdKeys: ["reporterAddress"],
    payloadKeys: [
      "disputeId",
      "tokenId",
      "reporterAddress",
      "creatorAddress",
      "counterStake",
      "paymentToken",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["disputeId", "tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.dispute_resolved",
    producer: "contracts-indexer",
    subjectType: "dispute",
    subjectIdKeys: ["disputeId"],
    actorIdKeys: ["resolverAddress"],
    payloadKeys: [
      "disputeId",
      "tokenId",
      "outcome",
      "resolverAddress",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["disputeId", "tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.dispute_appealed",
    producer: "contracts-indexer",
    subjectType: "dispute",
    subjectIdKeys: ["disputeId"],
    actorIdKeys: ["appealerAddress"],
    payloadKeys: [
      "disputeId",
      "appealerAddress",
      "appealNumber",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["disputeId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.content_reported",
    producer: "contracts-indexer",
    subjectType: "dispute",
    subjectIdKeys: ["disputeId"],
    actorIdKeys: ["reporterAddress"],
    payloadKeys: [
      "disputeId",
      "tokenId",
      "reporterAddress",
      "counterStake",
      "paymentToken",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["disputeId", "tokenId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.bounty_claimed",
    producer: "contracts-indexer",
    subjectType: "dispute",
    subjectIdKeys: ["disputeId"],
    actorIdKeys: ["reporterAddress"],
    payloadKeys: [
      "disputeId",
      "reporterAddress",
      "amount",
      "paymentToken",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["disputeId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
  {
    eventName: "contract.appeal_stake_deposited",
    producer: "contracts-indexer",
    subjectType: "dispute",
    subjectIdKeys: ["disputeId"],
    actorIdKeys: ["appealerAddress"],
    payloadKeys: [
      "disputeId",
      "appealerAddress",
      "appealStake",
      "paymentToken",
      "chainId",
      "contractAddress",
      "transactionHash",
      "blockNumber",
    ],
    sourceRefKeys: ["disputeId", "chainId", "contractAddress", "transactionHash", "blockNumber"],
  },
];

@Injectable()
export class AnalyticsDomainEventBridgeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AnalyticsDomainEventBridgeService.name);
  private readonly subscriptions: Subscription[] = [];

  constructor(
    private readonly eventBus: EventBus,
    private readonly ingestService: AnalyticsIngestService,
  ) {}

  onModuleInit() {
    this.subscriptions.push(
      this.eventBus.subscribe<StemsUploadedEvent>("stems.uploaded", (event) => this.recordStemsUploaded(event)),
      this.eventBus.subscribe<StemsProcessedEvent>("stems.processed", (event) => this.recordStemsProcessed(event)),
      this.eventBus.subscribe<StemsFailedEvent>("stems.failed", (event) => this.recordStemsFailed(event)),
      this.eventBus.subscribe<CatalogTrackStatusEvent>("catalog.track_status", (event) =>
        this.recordCatalogTrackStatus(event),
      ),
      this.eventBus.subscribe<CatalogReleaseReadyEvent>("catalog.release_ready", (event) =>
        this.recordCatalogReleaseReady(event),
      ),
      ...HIGH_VALUE_DOMAIN_EVENT_BRIDGES.map((config) =>
        this.eventBus.subscribe(config.eventName, (event) =>
          this.recordConfiguredDomainEvent(event as unknown as ResonateDomainEvent, config),
        ),
      ),
    );
  }

  onModuleDestroy() {
    this.subscriptions.forEach((subscription) => subscription.unsubscribe());
    this.subscriptions.length = 0;
  }

  private recordStemsUploaded(event: StemsUploadedEvent) {
    const tracks = event.metadata?.tracks ?? [];
    const trackIds = extractTrackIds(tracks);

    return this.ingest({
      eventName: "stems.uploaded",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "ingestion-service",
      privacyTier: "pseudonymous",
      subjectType: "release",
      subjectId: event.releaseId,
      actorId: event.artistId,
      payload: removeUndefined({
        releaseId: event.releaseId,
        artistId: event.artistId,
        sourceType: event.sourceType ?? "direct_upload",
        trackIds,
        trackCount: tracks.length,
        stemCount: countUploadedStems(tracks),
        retry: event.checksum === "retry",
      }),
      sourceRefs: removeUndefined({
        releaseId: event.releaseId,
        artistId: event.artistId,
      }),
    });
  }

  private recordStemsProcessed(event: StemsProcessedEvent) {
    const trackIds = event.tracks.map((track) => track.id);
    const stemIds = event.tracks.flatMap((track) => track.stems.map((stem) => stem.id));

    return this.ingest({
      eventName: "stems.processed",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "ingestion-service",
      privacyTier: "pseudonymous",
      subjectType: "release",
      subjectId: event.releaseId,
      actorId: event.artistId,
      payload: {
        releaseId: event.releaseId,
        artistId: event.artistId,
        modelVersion: event.modelVersion,
        trackIds,
        stemIds,
        trackCount: event.tracks.length,
        stemCount: stemIds.length,
      },
      sourceRefs: {
        releaseId: event.releaseId,
        artistId: event.artistId,
        modelVersion: event.modelVersion,
      },
    });
  }

  private recordStemsFailed(event: StemsFailedEvent) {
    return this.ingest({
      eventName: "stems.failed",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "ingestion-service",
      privacyTier: "pseudonymous",
      subjectType: "release",
      subjectId: event.releaseId,
      actorId: event.artistId,
      payload: {
        releaseId: event.releaseId,
        artistId: event.artistId,
        status: "failed",
        error: truncateError(event.error),
      },
      sourceRefs: {
        releaseId: event.releaseId,
        artistId: event.artistId,
      },
    });
  }

  private recordCatalogTrackStatus(event: CatalogTrackStatusEvent) {
    return this.ingest({
      eventName: "catalog.track_status",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "catalog-service",
      privacyTier: "pseudonymous",
      subjectType: "track",
      subjectId: event.trackId,
      payload: removeUndefined({
        releaseId: event.releaseId,
        trackId: event.trackId,
        status: event.status,
        error: truncateError(event.error),
      }),
      sourceRefs: {
        releaseId: event.releaseId,
        trackId: event.trackId,
        status: event.status,
      },
    });
  }

  private recordCatalogReleaseReady(event: CatalogReleaseReadyEvent) {
    const tracks = Array.isArray(event.metadata?.tracks) ? event.metadata.tracks : [];

    return this.ingest({
      eventName: "catalog.release_ready",
      eventVersion: event.eventVersion,
      occurredAt: event.occurredAt,
      producer: "catalog-service",
      privacyTier: "pseudonymous",
      subjectType: "release",
      subjectId: event.releaseId,
      actorId: event.artistId,
      payload: {
        releaseId: event.releaseId,
        artistId: event.artistId,
        status: "ready",
        trackIds: extractTrackIds(tracks),
        trackCount: tracks.length,
        stemCount: countUploadedStems(tracks),
      },
      sourceRefs: {
        releaseId: event.releaseId,
        artistId: event.artistId,
      },
    });
  }

  private recordConfiguredDomainEvent(event: ResonateDomainEvent, config: DomainBridgeConfig) {
    const subjectId = firstStringField(event, config.subjectIdKeys ?? []);
    const actorId = firstStringField(event, config.actorIdKeys ?? []);
    const sessionId = firstStringField(event, config.sessionIdKeys ?? []);
    const payload = compactPayload(event, config.payloadKeys);
    const sourceRefs = sourceRefsFrom(event, config.sourceRefKeys);

    return this.ingest(
      removeUndefined({
        eventName: config.eventName,
        eventVersion: event.eventVersion ?? 1,
        occurredAt: validOccurredAt(event.occurredAt),
        producer: config.producer,
        privacyTier: "pseudonymous",
        consentBasis: config.consentBasis,
        subjectType: subjectId && config.subjectType ? config.subjectType : undefined,
        subjectId,
        actorId,
        sessionId,
        payload: addDerivedPayloadFields(event, payload),
        sourceRefs: Object.keys(sourceRefs).length ? sourceRefs : undefined,
      }),
    );
  }

  private async ingest(input: AnalyticsEventInput) {
    try {
      await this.ingestService.ingest(input);
    } catch (error) {
      this.logger.warn(
        `Failed to bridge ${input.eventName ?? "unknown"} into analytics: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}

function extractTrackIds(tracks: Array<Record<string, unknown>>): string[] {
  return tracks.map((track) => track.id).filter((id): id is string => typeof id === "string" && id.length > 0);
}

function countUploadedStems(tracks: Array<{ stems?: unknown }>) {
  return tracks.reduce((count, track) => count + (Array.isArray(track.stems) ? track.stems.length : 0), 0);
}

function truncateError(error: string | undefined) {
  if (!error) {
    return undefined;
  }
  return error.length > 240 ? `${error.slice(0, 237)}...` : error;
}

function removeUndefined<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}

function firstStringField(event: ResonateDomainEvent, keys: readonly string[]) {
  for (const key of keys) {
    const value = analyticsScalar(event[key]);
    if (typeof value === "string" && value.length > 0) {
      return value;
    }
  }
  return undefined;
}

function compactPayload(event: ResonateDomainEvent, keys: readonly string[]) {
  const payload: Record<string, unknown> = {};
  for (const key of keys) {
    const value = analyticsValue(event[key], key);
    if (value !== undefined) {
      payload[key] = value;
    }
  }
  return payload;
}

function sourceRefsFrom(event: ResonateDomainEvent, keys: readonly string[]) {
  const refs: Record<string, string> = {};
  for (const key of keys) {
    const value = analyticsScalar(event[key]);
    if (value !== undefined && value !== "") {
      refs[key] = String(value);
    }
  }
  return refs;
}

function addDerivedPayloadFields(event: ResonateDomainEvent, payload: Record<string, unknown>) {
  const canonicalAmountUsd = numberField(event.canonicalAmountUsd ?? event.amountUsd ?? event.priceUsd);
  if (canonicalAmountUsd !== undefined) {
    payload.canonicalAmountUsd = canonicalAmountUsd;
  }

  if (Array.isArray(payload.trackIds)) {
    payload.trackCount = payload.trackIds.length;
  }
  if (Array.isArray(payload.stemIds)) {
    payload.stemCount = payload.stemIds.length;
  }

  return payload;
}

function analyticsValue(value: unknown, key?: string): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (key === "error" || key === "reason") {
    return truncateError(String(value));
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    const values = value
      .map((entry) => analyticsScalar(entry))
      .filter((entry): entry is string | number | boolean => entry !== undefined);
    return values.length ? values : undefined;
  }
  if (key === "preferences" && typeof value === "object") {
    return compactAnalyticsObject(value as Record<string, unknown>);
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function compactAnalyticsObject(value: Record<string, unknown>) {
  const output: Record<string, string | number | boolean | Array<string | number | boolean>> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 40)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key)) {
      continue;
    }
    const analyticsEntry = analyticsValue(entry);
    if (
      typeof analyticsEntry === "string" ||
      typeof analyticsEntry === "number" ||
      typeof analyticsEntry === "boolean" ||
      Array.isArray(analyticsEntry)
    ) {
      output[key] = analyticsEntry;
    }
  }
  return Object.keys(output).length ? output : undefined;
}

function analyticsScalar(value: unknown) {
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return undefined;
}

function numberField(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function validOccurredAt(value: unknown) {
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
    return value;
  }
  return new Date().toISOString();
}
