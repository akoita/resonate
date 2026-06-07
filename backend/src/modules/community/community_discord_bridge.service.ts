import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { EventBus } from "../shared/event_bus";

const DISCORD_WEBHOOK_HOSTS = new Set(["discord.com", "discordapp.com"]);
const DISCORD_INVITE_HOSTS = new Set(["discord.gg", "discord.com", "discordapp.com"]);
const BRIDGE_STATUSES = ["connected", "disconnected", "failed"] as const;
const RESONATE_ROLE_TYPES = ["holder", "supporter", "member"] as const;

type DiscordBridgeStatus = (typeof BRIDGE_STATUSES)[number];
type ResonateRoleType = (typeof RESONATE_ROLE_TYPES)[number];

export type UpsertDiscordBridgeInput = {
  webhookUrl?: unknown;
  inviteUrl?: unknown;
  serverId?: unknown;
  serverName?: unknown;
  channelId?: unknown;
  channelName?: unknown;
  publicLinkEnabled?: unknown;
  announcementMirrorEnabled?: unknown;
  roleSyncEnabled?: unknown;
};

export type UpsertDiscordRoleMappingInput = {
  resonateRole?: unknown;
  scopeType?: unknown;
  scopeId?: unknown;
  discordRoleId?: unknown;
  label?: unknown;
  enabled?: unknown;
};

type DiscordBridgeWithRelations = Awaited<ReturnType<CommunityDiscordBridgeService["findBridgeWithRelations"]>>;
type DiscordBridgeRecord = NonNullable<DiscordBridgeWithRelations>;

@Injectable()
export class CommunityDiscordBridgeService {
  constructor(private readonly eventBus: EventBus) {}

  async getArtistBridge(actorUserId: string, artistId: string) {
    await this.requireArtistOperator(actorUserId, artistId);
    const bridge = await this.findBridgeWithRelations(artistId);
    return {
      schemaVersion: "community-discord-bridge/v1",
      artistId,
      bridge: bridge ? this.bridgeDto(bridge, true) : null,
    };
  }

  async getPublicArtistBridge(artistId: string) {
    const bridge = await prisma.communityDiscordBridge.findFirst({
      where: {
        artistId,
        status: "connected",
        publicLinkEnabled: true,
        inviteUrl: { not: null },
      },
      select: {
        artistId: true,
        serverName: true,
        inviteUrl: true,
      },
    });

    return {
      schemaVersion: "community-discord-public/v1",
      artistId,
      discord: bridge
        ? {
            serverName: bridge.serverName,
            inviteUrl: bridge.inviteUrl,
          }
        : null,
    };
  }

  async connectArtistBridge(actorUserId: string, artistId: string, input: UpsertDiscordBridgeInput) {
    await this.requireArtistOperator(actorUserId, artistId);
    const existing = await prisma.communityDiscordBridge.findUnique({
      where: { artistId },
      select: { webhookUrl: true, webhookUrlMasked: true },
    });
    const hasWebhookUpdate = hasInputValue(input.webhookUrl);
    const webhookUrl = hasWebhookUpdate
      ? normalizeDiscordWebhookUrl(input.webhookUrl)
      : existing?.webhookUrl ?? null;
    if (!webhookUrl) {
      throw new BadRequestException("webhookUrl is required");
    }
    const inviteUrl = normalizeDiscordInviteUrl(input.inviteUrl);
    const now = new Date();
    const data = {
      webhookUrl,
      webhookUrlMasked: hasWebhookUpdate
        ? maskWebhookUrl(webhookUrl)
        : existing?.webhookUrlMasked ?? maskWebhookUrl(webhookUrl),
      inviteUrl,
      serverId: optionalString(input.serverId, 80),
      serverName: optionalString(input.serverName, 120),
      channelId: optionalString(input.channelId, 80),
      channelName: optionalString(input.channelName, 120),
      publicLinkEnabled: booleanInput(input.publicLinkEnabled, false),
      announcementMirrorEnabled: booleanInput(input.announcementMirrorEnabled, true),
      roleSyncEnabled: booleanInput(input.roleSyncEnabled, false),
      status: "connected" as DiscordBridgeStatus,
      lastFailureAt: null,
      lastFailureReason: null,
    };

    const bridge = await prisma.communityDiscordBridge.upsert({
      where: { artistId },
      create: {
        artistId,
        ...data,
      },
      update: {
        ...data,
        updatedAt: now,
      },
      include: bridgeInclude,
    });

    this.eventBus.publish({
      eventName: "community.discord_bridge_connected",
      eventVersion: 1,
      occurredAt: now.toISOString(),
      actorId: actorUserId,
      artistId,
      publicLinkEnabled: bridge.publicLinkEnabled,
      announcementMirrorEnabled: bridge.announcementMirrorEnabled,
      roleSyncEnabled: bridge.roleSyncEnabled,
    } as never);

    return {
      schemaVersion: "community-discord-bridge/v1",
      artistId,
      bridge: this.bridgeDto(bridge, true),
    };
  }

  async disconnectArtistBridge(actorUserId: string, artistId: string) {
    await this.requireArtistOperator(actorUserId, artistId);
    const bridge = await prisma.communityDiscordBridge.findUnique({ where: { artistId } });
    if (!bridge) {
      return {
        schemaVersion: "community-discord-bridge/v1",
        artistId,
        bridge: null,
      };
    }

    const updated = await prisma.communityDiscordBridge.update({
      where: { artistId },
      data: {
        webhookUrl: null,
        webhookUrlMasked: "disconnected",
        publicLinkEnabled: false,
        announcementMirrorEnabled: false,
        roleSyncEnabled: false,
        status: "disconnected",
        lastFailureAt: null,
        lastFailureReason: null,
      },
      include: bridgeInclude,
    });

    return {
      schemaVersion: "community-discord-bridge/v1",
      artistId,
      bridge: this.bridgeDto(updated, true),
    };
  }

  async testArtistBridge(actorUserId: string, artistId: string) {
    await this.requireArtistOperator(actorUserId, artistId);
    const bridge = await this.requireConnectedBridge(artistId);
    const result = await this.sendWebhook(bridge, {
      content: `Resonate Discord bridge test for ${bridge.artist.displayName}.`,
    }, {
      action: "webhook_test",
      requestSummary: { artistId, serverName: bridge.serverName ?? null, channelName: bridge.channelName ?? null },
    });

    const refreshed = await this.findBridgeWithRelations(artistId);
    return {
      schemaVersion: "community-discord-bridge-test/v1",
      ok: result.ok,
      attempt: result.attempt,
      bridge: refreshed ? this.bridgeDto(refreshed, true) : null,
    };
  }

  async upsertRoleMapping(actorUserId: string, artistId: string, input: UpsertDiscordRoleMappingInput) {
    await this.requireArtistOperator(actorUserId, artistId);
    const bridge = await this.requireConnectedBridge(artistId);
    const resonateRole = normalizeResonateRole(input.resonateRole);
    const scopeType = optionalString(input.scopeType, 60) || "artist";
    const scopeId = optionalString(input.scopeId, 120) || artistId;
    if (scopeType !== "artist" || scopeId !== artistId) {
      throw new BadRequestException("Discord role mappings for this slice must be scoped to the artist");
    }
    const discordRoleId = requiredString(input.discordRoleId, "discordRoleId", 120);

    const mapping = await prisma.communityDiscordRoleMapping.upsert({
      where: {
        CommunityDiscordRoleMapping_identity: {
          bridgeId: bridge.id,
          resonateRole,
          scopeType,
          scopeId,
          discordRoleId,
        },
      },
      create: {
        bridgeId: bridge.id,
        resonateRole,
        scopeType,
        scopeId,
        discordRoleId,
        label: optionalString(input.label, 120),
        enabled: booleanInput(input.enabled, true),
      },
      update: {
        label: optionalString(input.label, 120),
        enabled: booleanInput(input.enabled, true),
      },
    });

    return {
      schemaVersion: "community-discord-role-mapping/v1",
      artistId,
      mapping: roleMappingDto(mapping),
    };
  }

  async syncRoles(actorUserId: string, artistId: string) {
    await this.requireArtistOperator(actorUserId, artistId);
    const bridge = await this.requireConnectedBridge(artistId);
    const mappings = await prisma.communityDiscordRoleMapping.findMany({
      where: { bridgeId: bridge.id, enabled: true },
      orderBy: [{ createdAt: "asc" }],
    });

    const startedAt = new Date();
    const summaries = [];
    for (const mapping of mappings) {
      const eligibleCount = await this.countEligibleRoleCandidates(mapping);
      const status = bridge.roleSyncEnabled ? "dry_run" : "skipped";
      const reason = bridge.roleSyncEnabled
        ? "discord_account_linking_required"
        : "role_sync_disabled";
      await prisma.communityDiscordRoleMapping.update({
        where: { id: mapping.id },
        data: {
          lastSyncedAt: startedAt,
          lastStatus: status,
          lastReason: reason,
        },
      });
      summaries.push({
        ...roleMappingDto(mapping),
        eligibleCount,
        status,
        reason,
      });
    }

    const attempt = await prisma.communityDiscordSyncAttempt.create({
      data: {
        bridgeId: bridge.id,
        action: "role_sync",
        status: bridge.roleSyncEnabled ? "dry_run" : "skipped",
        requestSummary: {
          artistId,
          mappingCount: mappings.length,
          totalEligibleCount: summaries.reduce((sum, item) => sum + item.eligibleCount, 0),
          privacy: "aggregate_counts_only",
        },
        completedAt: new Date(),
      },
    });
    await prisma.communityDiscordBridge.update({
      where: { id: bridge.id },
      data: { lastRoleSyncAt: attempt.completedAt ?? new Date() },
    });

    const eventName = bridge.roleSyncEnabled
      ? "community.discord_role_sync_completed"
      : "community.discord_role_sync_failed";
    this.eventBus.publish({
      eventName,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      actorId: actorUserId,
      artistId,
      mappingCount: mappings.length,
      status: attempt.status,
      reason: bridge.roleSyncEnabled ? "dry_run" : "role_sync_disabled",
    } as never);

    return {
      schemaVersion: "community-discord-role-sync/v1",
      artistId,
      status: attempt.status,
      attempt: syncAttemptDto(attempt),
      mappings: summaries,
      privacy: {
        memberDetailsExposed: false,
        source: "server_side_roles",
      },
    };
  }

  async mirrorAnnouncement(input: {
    room: { id: string; roomType: string; ownerType: string; artistId: string | null; title: string };
    message: { id: string; body: string; messageType: string; authorId: string; createdAt: Date };
  }) {
    if (input.message.messageType !== "announcement" || input.room.ownerType !== "artist" || !input.room.artistId) {
      return null;
    }
    const bridge = await prisma.communityDiscordBridge.findFirst({
      where: {
        artistId: input.room.artistId,
        status: "connected",
        announcementMirrorEnabled: true,
        webhookUrl: { not: null },
      },
      include: {
        artist: true,
      },
    });
    if (!bridge) return null;

    const result = await this.sendWebhook(bridge, {
      content: formatAnnouncementContent(input.message.body),
      username: `${bridge.artist.displayName} on Resonate`,
      allowed_mentions: { parse: [] },
    }, {
      action: "announcement_mirror",
      messageId: input.message.id,
      requestSummary: {
        roomId: input.room.id,
        roomTitle: input.room.title,
        messageType: input.message.messageType,
        bodyChars: input.message.body.length,
      },
    });

    if (result.ok) {
      this.eventBus.publish({
        eventName: "community.discord_announcement_mirrored",
        eventVersion: 1,
        occurredAt: new Date().toISOString(),
        actorId: input.message.authorId,
        artistId: input.room.artistId,
        roomId: input.room.id,
        messageId: input.message.id,
        attemptId: result.attempt.id,
        status: result.attempt.status,
      } as never);
    }

    return result;
  }

  async retryAttempt(actorUserId: string, artistId: string, attemptId: string) {
    await this.requireArtistOperator(actorUserId, artistId);
    const attempt = await prisma.communityDiscordSyncAttempt.findUnique({
      where: { id: attemptId },
      include: { bridge: { include: { artist: true } } },
    });
    if (!attempt || attempt.bridge.artistId !== artistId) {
      throw new NotFoundException("Discord sync attempt not found");
    }
    if (attempt.action !== "announcement_mirror" || !attempt.messageId) {
      throw new BadRequestException("Only failed announcement mirror attempts can be retried in this slice");
    }
    if (attempt.status !== "failed") {
      throw new BadRequestException("Only failed Discord attempts can be retried");
    }
    const message = await prisma.communityMessage.findUnique({
      where: { id: attempt.messageId },
      include: { room: true },
    });
    if (!message) throw new NotFoundException("Community message not found");

    const result = await this.sendWebhook(attempt.bridge, {
      content: formatAnnouncementContent(message.body),
      username: `${attempt.bridge.artist.displayName} on Resonate`,
      allowed_mentions: { parse: [] },
    }, {
      action: "announcement_mirror",
      messageId: message.id,
      retryOfId: attempt.id,
      attemptCount: attempt.attemptCount + 1,
      requestSummary: {
        roomId: message.roomId,
        messageType: message.messageType,
        bodyChars: message.body.length,
        retry: true,
      },
    });

    return {
      schemaVersion: "community-discord-retry/v1",
      artistId,
      ok: result.ok,
      attempt: result.attempt,
    };
  }

  private async requireArtistOperator(userId: string, artistId: string) {
    const artist = await prisma.artist.findUnique({ where: { id: artistId } });
    if (!artist) throw new NotFoundException("Artist not found");
    if (!(artist.userId === userId || userId === "operator" || userId === "admin")) {
      throw new ForbiddenException("Discord bridge management is restricted to the artist owner or operators");
    }
    return artist;
  }

  private async requireConnectedBridge(artistId: string) {
    const bridge = await prisma.communityDiscordBridge.findUnique({
      where: { artistId },
      include: {
        artist: true,
        roleMappings: { orderBy: [{ createdAt: "asc" }] },
        syncAttempts: { orderBy: [{ createdAt: "desc" }], take: 5 },
      },
    });
    if (!bridge || !["connected", "failed"].includes(bridge.status) || !bridge.webhookUrl) {
      throw new NotFoundException("Discord bridge is not connected");
    }
    return bridge;
  }

  private findBridgeWithRelations(artistId: string) {
    return prisma.communityDiscordBridge.findUnique({
      where: { artistId },
      include: bridgeInclude,
    });
  }

  private async countEligibleRoleCandidates(mapping: {
    resonateRole: string;
    scopeType: string;
    scopeId: string;
  }) {
    return prisma.communityRole.count({
      where: {
        roleType: mapping.resonateRole,
        scopeType: mapping.scopeType,
        scopeId: mapping.scopeId,
        revokedAt: null,
      },
    });
  }

  private async sendWebhook(
    bridge: {
      id: string;
      artistId: string;
      webhookUrl: string | null;
    },
    payload: Record<string, unknown>,
    options: {
      action: string;
      messageId?: string;
      retryOfId?: string;
      attemptCount?: number;
      requestSummary?: Prisma.InputJsonValue;
    },
  ): Promise<{ ok: boolean; attempt: ReturnType<typeof syncAttemptDto> }> {
    if (!bridge.webhookUrl) {
      const attempt = await this.recordFailedAttempt(bridge.id, options, "missing_webhook_url");
      return { ok: false, attempt: syncAttemptDto(attempt) };
    }

    const started = await prisma.communityDiscordSyncAttempt.create({
      data: {
        bridgeId: bridge.id,
        action: options.action,
        status: "pending",
        messageId: options.messageId,
        retryOfId: options.retryOfId,
        attemptCount: options.attemptCount ?? 1,
        requestSummary: options.requestSummary,
      },
    });

    try {
      const response = await fetch(bridge.webhookUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const errorText = await response.text().catch(() => "");
        const reason = `discord_http_${response.status}${errorText ? `: ${errorText.slice(0, 160)}` : ""}`;
        const failed = await this.finishAttempt(started.id, bridge.id, "failed", response.status, reason);
        return { ok: false, attempt: syncAttemptDto(failed) };
      }
      const completed = await this.finishAttempt(started.id, bridge.id, "completed", response.status, null);
      return { ok: true, attempt: syncAttemptDto(completed) };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const failed = await this.finishAttempt(started.id, bridge.id, "failed", null, `discord_unreachable: ${reason}`);
      return { ok: false, attempt: syncAttemptDto(failed) };
    }
  }

  private async finishAttempt(
    attemptId: string,
    bridgeId: string,
    status: "completed" | "failed",
    responseStatus: number | null,
    errorReason: string | null,
  ) {
    const completedAt = new Date();
    const attempt = await prisma.communityDiscordSyncAttempt.update({
      where: { id: attemptId },
      data: {
        status,
        responseStatus,
        errorReason,
        completedAt,
      },
    });
    await prisma.communityDiscordBridge.update({
      where: { id: bridgeId },
      data: status === "completed"
        ? {
            status: "connected",
            lastFailureAt: null,
            lastFailureReason: null,
            ...(attempt.action === "webhook_test" ? { lastTestedAt: completedAt } : {}),
            ...(attempt.action === "announcement_mirror" ? { lastMirroredAt: completedAt } : {}),
          }
        : {
            status: "failed",
            lastFailureAt: completedAt,
            lastFailureReason: errorReason,
          },
    });
    return attempt;
  }

  private async recordFailedAttempt(
    bridgeId: string,
    options: {
      action: string;
      messageId?: string;
      retryOfId?: string;
      attemptCount?: number;
      requestSummary?: Prisma.InputJsonValue;
    },
    reason: string,
  ) {
    const completedAt = new Date();
    await prisma.communityDiscordBridge.update({
      where: { id: bridgeId },
      data: {
        status: "failed",
        lastFailureAt: completedAt,
        lastFailureReason: reason,
      },
    });
    return prisma.communityDiscordSyncAttempt.create({
      data: {
        bridgeId,
        action: options.action,
        status: "failed",
        messageId: options.messageId,
        retryOfId: options.retryOfId,
        attemptCount: options.attemptCount ?? 1,
        requestSummary: options.requestSummary,
        errorReason: reason,
        completedAt,
      },
    });
  }

  private bridgeDto(bridge: DiscordBridgeRecord, includePrivate: boolean) {
    return {
      id: bridge.id,
      artistId: bridge.artistId,
      provider: bridge.provider,
      serverId: includePrivate ? bridge.serverId : undefined,
      serverName: bridge.serverName,
      channelId: includePrivate ? bridge.channelId : undefined,
      channelName: bridge.channelName,
      webhookUrlMasked: includePrivate ? bridge.webhookUrlMasked : undefined,
      inviteUrl: bridge.publicLinkEnabled || includePrivate ? bridge.inviteUrl : null,
      publicLinkEnabled: bridge.publicLinkEnabled,
      announcementMirrorEnabled: includePrivate ? bridge.announcementMirrorEnabled : undefined,
      roleSyncEnabled: includePrivate ? bridge.roleSyncEnabled : undefined,
      status: bridge.status,
      lastTestedAt: bridge.lastTestedAt?.toISOString() ?? null,
      lastMirroredAt: bridge.lastMirroredAt?.toISOString() ?? null,
      lastRoleSyncAt: bridge.lastRoleSyncAt?.toISOString() ?? null,
      lastFailureAt: bridge.lastFailureAt?.toISOString() ?? null,
      lastFailureReason: includePrivate ? bridge.lastFailureReason : null,
      roleMappings: includePrivate ? bridge.roleMappings.map(roleMappingDto) : [],
      recentAttempts: includePrivate ? bridge.syncAttempts.map(syncAttemptDto) : [],
      createdAt: bridge.createdAt.toISOString(),
      updatedAt: bridge.updatedAt.toISOString(),
      privacy: {
        webhookUrlReturned: false,
        memberDetailsReturned: false,
      },
    };
  }
}

const bridgeInclude = {
  artist: true,
  roleMappings: { orderBy: [{ createdAt: "asc" as const }] },
  syncAttempts: { orderBy: [{ createdAt: "desc" as const }], take: 5 },
};

function roleMappingDto(mapping: {
  id: string;
  resonateRole: string;
  scopeType: string;
  scopeId: string;
  discordRoleId: string;
  label: string | null;
  enabled: boolean;
  lastSyncedAt: Date | null;
  lastStatus: string;
  lastReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: mapping.id,
    resonateRole: mapping.resonateRole,
    scopeType: mapping.scopeType,
    scopeId: mapping.scopeId,
    discordRoleId: mapping.discordRoleId,
    label: mapping.label,
    enabled: mapping.enabled,
    lastSyncedAt: mapping.lastSyncedAt?.toISOString() ?? null,
    lastStatus: mapping.lastStatus,
    lastReason: mapping.lastReason,
    createdAt: mapping.createdAt.toISOString(),
    updatedAt: mapping.updatedAt.toISOString(),
  };
}

function syncAttemptDto(attempt: {
  id: string;
  action: string;
  status: string;
  messageId: string | null;
  roleMappingId: string | null;
  retryOfId: string | null;
  attemptCount: number;
  requestSummary: Prisma.JsonValue | null;
  responseStatus: number | null;
  errorReason: string | null;
  createdAt: Date;
  completedAt: Date | null;
}) {
  return {
    id: attempt.id,
    action: attempt.action,
    status: attempt.status,
    messageId: attempt.messageId,
    roleMappingId: attempt.roleMappingId,
    retryOfId: attempt.retryOfId,
    attemptCount: attempt.attemptCount,
    requestSummary: attempt.requestSummary,
    responseStatus: attempt.responseStatus,
    errorReason: attempt.errorReason,
    createdAt: attempt.createdAt.toISOString(),
    completedAt: attempt.completedAt?.toISOString() ?? null,
  };
}

function normalizeDiscordWebhookUrl(value: unknown) {
  const raw = requiredString(value, "webhookUrl", 2048);
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequestException("Discord webhook URL is invalid");
  }
  if (parsed.protocol !== "https:" || !DISCORD_WEBHOOK_HOSTS.has(parsed.hostname.toLowerCase())) {
    throw new BadRequestException("Discord webhook URL must be a Discord HTTPS webhook");
  }
  if (!parsed.pathname.startsWith("/api/webhooks/")) {
    throw new BadRequestException("Discord webhook URL must use /api/webhooks/");
  }
  return parsed.toString();
}

function normalizeDiscordInviteUrl(value: unknown) {
  const raw = optionalString(value, 2048);
  if (!raw) return null;
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new BadRequestException("Discord invite URL is invalid");
  }
  const host = parsed.hostname.toLowerCase();
  if (parsed.protocol !== "https:" || !DISCORD_INVITE_HOSTS.has(host)) {
    throw new BadRequestException("Discord invite URL must be a Discord HTTPS invite");
  }
  const validDiscordComInvite = (host === "discord.com" || host === "discordapp.com")
    && parsed.pathname.startsWith("/invite/");
  if (host !== "discord.gg" && !validDiscordComInvite) {
    throw new BadRequestException("Discord invite URL must use discord.gg or /invite/");
  }
  return parsed.toString();
}

function normalizeResonateRole(value: unknown): ResonateRoleType {
  const role = requiredString(value, "resonateRole", 60).toLowerCase();
  if (!RESONATE_ROLE_TYPES.includes(role as ResonateRoleType)) {
    throw new BadRequestException("resonateRole must be holder, supporter, or member");
  }
  return role as ResonateRoleType;
}

function requiredString(value: unknown, field: string, maxLength: number) {
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${field} is required`);
  }
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new BadRequestException(`${field} is too long`);
  }
  return normalized;
}

function optionalString(value: unknown, maxLength: number) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new BadRequestException("Expected a string value");
  const normalized = value.trim();
  if (!normalized) return null;
  if (normalized.length > maxLength) throw new BadRequestException("String value is too long");
  return normalized;
}

function hasInputValue(value: unknown) {
  if (value === undefined || value === null) return false;
  return typeof value !== "string" || value.trim().length > 0;
}

function booleanInput(value: unknown, fallback: boolean) {
  return typeof value === "boolean" ? value : fallback;
}

function maskWebhookUrl(webhookUrl: string) {
  const parsed = new URL(webhookUrl);
  const parts = parsed.pathname.split("/").filter(Boolean);
  const webhookId = parts[2] ?? "webhook";
  return `${parsed.origin}/api/webhooks/${webhookId}/...`;
}

function formatAnnouncementContent(body: string) {
  const normalized = body.trim().replace(/\s+/g, " ");
  const bounded = normalized.length > 1800 ? `${normalized.slice(0, 1797)}...` : normalized;
  return bounded || "New Resonate announcement.";
}
