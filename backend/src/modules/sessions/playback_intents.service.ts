import { BadRequestException, Inject, Injectable, Optional } from "@nestjs/common";
import { randomUUID } from "crypto";
import { EventBus } from "../shared/event_bus";

export type PlaybackCapabilityScope =
  | "playback.intent"
  | "playback.resolve"
  | "playback.queue"
  | "playback.play"
  | "playback.control"
  | "playback.status";

export type PlaybackIntentOutcome =
  | "queued"
  | "playing"
  | "confirmation_required"
  | "no_active_device"
  | "blocked_by_policy"
  | "unavailable";

export type PlaybackConfirmationMode =
  | "propose_only"
  | "queue_with_confirmation"
  | "remote_control_when_active";

export type PlaybackCommandAction = "queue" | "play" | "pause" | "resume" | "skip" | "seek" | "stop";

export type PlaybackCommandStatus =
  | "pending"
  | "pending_confirmation"
  | "queued"
  | "playing"
  | "blocked"
  | "unavailable";

export type PlaybackSource = "resonate_catalog" | "library" | "purchased" | "preview";

export interface PlaybackIntentConstraints {
  maxTracks?: number;
  explicit?: boolean;
  source?: PlaybackSource;
  genres?: string[];
  mood?: string;
}

export interface PlaybackIntentCandidate {
  trackId: string;
  title: string;
  artistId?: string;
  artistName?: string | null;
  releaseId?: string;
  releaseTitle?: string | null;
  explicit: boolean;
  source: "catalog";
  playable: true;
  reasons: string[];
}

export interface PlaybackCapability {
  id: string;
  ownerUserId: string;
  scopes: PlaybackCapabilityScope[];
  allowedSources: PlaybackSource[];
  confirmationMode: PlaybackConfirmationMode;
  expiresAt?: string;
  revokedAt?: string;
  rateLimitPerMinute: number;
  createdAt: string;
}

export interface PlaybackDevice {
  deviceId: string;
  ownerUserId: string;
  label: string;
  active: boolean;
  supports: PlaybackCapabilityScope[];
  currentTrackId?: string;
  state: "idle" | "playing" | "paused";
  lastSeenAt: string;
}

export interface PlaybackIntentCommand {
  commandId: string;
  ownerUserId: string;
  action: PlaybackCommandAction;
  status: PlaybackCommandStatus;
  outcome: PlaybackIntentOutcome;
  trackIds: string[];
  deviceId?: string;
  sessionId?: string;
  capabilityId: string;
  requiresConfirmation: boolean;
  initiator: "listener" | "external_agent" | "ai_dj";
  agentOriginated: boolean;
  createdAt: string;
  updatedAt: string;
  confirmedAt?: string;
  reason?: string;
}

export interface PlaybackIntentCatalogResolver {
  resolve(input: {
    ownerUserId: string;
    query?: string;
    constraints: Required<Pick<PlaybackIntentConstraints, "maxTracks" | "explicit" | "source">> &
      Omit<PlaybackIntentConstraints, "maxTracks" | "explicit" | "source">;
  }): Promise<PlaybackIntentCandidate[]>;
}

export const PLAYBACK_INTENT_CATALOG_RESOLVER = Symbol("PLAYBACK_INTENT_CATALOG_RESOLVER");

const ALL_PLAYBACK_SCOPES: PlaybackCapabilityScope[] = [
  "playback.intent",
  "playback.resolve",
  "playback.queue",
  "playback.play",
  "playback.control",
  "playback.status",
];

const DEVICE_TTL_MS = 45_000;
const DEFAULT_RATE_LIMIT_PER_MINUTE = 30;

@Injectable()
export class PrismaPlaybackIntentCatalogResolver implements PlaybackIntentCatalogResolver {
  async resolve(input: {
    ownerUserId: string;
    query?: string;
    constraints: Required<Pick<PlaybackIntentConstraints, "maxTracks" | "explicit" | "source">> &
      Omit<PlaybackIntentConstraints, "maxTracks" | "explicit" | "source">;
  }): Promise<PlaybackIntentCandidate[]> {
    if (input.constraints.source !== "resonate_catalog" && input.constraints.source !== "preview") {
      return [];
    }

    const { prisma } = await import("../../db/prisma");
    const query = input.query?.trim();
    const maxTracks = Math.min(Math.max(input.constraints.maxTracks, 1), 10);
    const tracks = await prisma.track.findMany({
      where: {
        ...(input.constraints.explicit === false ? { explicit: false } : {}),
        ...(query
          ? {
              OR: [
                { title: { contains: query, mode: "insensitive" } },
                { artist: { contains: query, mode: "insensitive" } },
                { release: { title: { contains: query, mode: "insensitive" } } },
              ],
            }
          : {}),
      },
      include: {
        release: {
          select: {
            id: true,
            title: true,
            artistId: true,
            artist: { select: { displayName: true } },
          },
        },
      },
      orderBy: { createdAt: "desc" },
      take: maxTracks,
    });

    return tracks.map((track) => ({
      trackId: track.id,
      title: track.title,
      artistId: track.release.artistId,
      artistName: track.artist || track.release.artist?.displayName || null,
      releaseId: track.releaseId,
      releaseTitle: track.release.title,
      explicit: track.explicit,
      source: "catalog" as const,
      playable: true as const,
      reasons: buildCandidateReasons({
        query,
        genres: input.constraints.genres,
        mood: input.constraints.mood,
      }),
    }));
  }
}

@Injectable()
export class PlaybackIntentsService {
  private readonly capabilities = new Map<string, PlaybackCapability>();
  private readonly devices = new Map<string, PlaybackDevice>();
  private readonly commands = new Map<string, PlaybackIntentCommand>();
  private readonly requestTimestamps = new Map<string, number[]>();

  constructor(
    @Optional()
    @Inject(PLAYBACK_INTENT_CATALOG_RESOLVER)
    private readonly catalogResolver?: PlaybackIntentCatalogResolver,
    @Optional()
    private readonly eventBus?: EventBus,
  ) {}

  capabilitiesForOwner(ownerUserId: string) {
    const capability = this.defaultOwnerCapability(ownerUserId);
    const activeDevices = this.activeDevicesForOwner(ownerUserId);
    return {
      ownerUserId,
      capability,
      activeDevices,
      available: activeDevices.length > 0,
      policy: {
        accountlessPlayback: false,
        paymentOrLicensingAllowed: false,
        defaultConfirmationMode: capability.confirmationMode,
        analyticsMarkersRequired: true,
      },
    };
  }

  createCapability(ownerUserId: string, input: Partial<PlaybackCapability>) {
    const now = new Date().toISOString();
    const capability: PlaybackCapability = {
      id: input.id || `playback_cap_${randomUUID()}`,
      ownerUserId,
      scopes: normalizeScopes(input.scopes, ALL_PLAYBACK_SCOPES),
      allowedSources: normalizeSources(input.allowedSources),
      confirmationMode: normalizeConfirmationMode(input.confirmationMode),
      expiresAt: input.expiresAt,
      revokedAt: input.revokedAt,
      rateLimitPerMinute: normalizeRateLimit(input.rateLimitPerMinute),
      createdAt: input.createdAt || now,
    };
    this.capabilities.set(capability.id, capability);
    return capability;
  }

  revokeCapability(ownerUserId: string, capabilityId: string) {
    const capability = this.capabilities.get(capabilityId);
    if (!capability || capability.ownerUserId !== ownerUserId) {
      return { status: "not_found" as const, capabilityId };
    }
    const revoked = { ...capability, revokedAt: new Date().toISOString() };
    this.capabilities.set(capabilityId, revoked);
    return { status: "revoked" as const, capability: revoked };
  }

  registerDevice(ownerUserId: string, input: Partial<PlaybackDevice>) {
    const now = new Date().toISOString();
    const device: PlaybackDevice = {
      deviceId: input.deviceId?.trim() || `device_${randomUUID()}`,
      ownerUserId,
      label: input.label?.trim() || "Resonate client",
      active: input.active ?? true,
      supports: normalizeScopes(input.supports, ALL_PLAYBACK_SCOPES),
      currentTrackId: input.currentTrackId?.trim() || undefined,
      state: input.state ?? "idle",
      lastSeenAt: now,
    };
    this.devices.set(device.deviceId, device);
    return device;
  }

  async resolve(ownerUserId: string, input: {
    query?: string;
    constraints?: PlaybackIntentConstraints;
    capabilityId?: string;
    initiator?: "listener" | "external_agent" | "ai_dj";
    sessionId?: string;
  }) {
    const capability = this.resolveCapability(ownerUserId, input.capabilityId);
    const policy = this.evaluatePolicy({
      ownerUserId,
      capability,
      scope: "playback.resolve",
      source: input.constraints?.source ?? "resonate_catalog",
    });
    if (!policy.allowed) {
      return this.blockedResponse(ownerUserId, capability, policy.reason);
    }

    const constraints = normalizeConstraints(input.constraints);
    const candidates = await this.catalogResolverOrDefault().resolve({
      ownerUserId,
      query: sanitizeQuery(input.query),
      constraints,
    });
    const outcome: PlaybackIntentOutcome = candidates.length > 0 ? "queued" : "unavailable";

    this.publish("playback.agent_intent_received", {
      ownerUserId,
      sessionId: input.sessionId,
      capabilityId: capability.id,
      action: "resolve",
      initiator: input.initiator ?? "external_agent",
      candidateCount: candidates.length,
    });

    return {
      ownerUserId,
      capabilityId: capability.id,
      outcome,
      policy: policySummary(capability, policy.reason),
      candidates,
      nextAllowedCommands: candidates.length > 0 ? ["queue", "play"] : [],
      redaction: {
        privateLibrary: "redacted",
        privateTaste: "redacted",
        wallet: "redacted",
        ownership: "redacted",
      },
    };
  }

  requestQueue(ownerUserId: string, input: CommandRequestInput) {
    const capability = this.resolveCapability(ownerUserId, input.capabilityId);
    const policy = this.evaluatePolicy({
      ownerUserId,
      capability,
      scope: "playback.queue",
      source: input.source ?? "resonate_catalog",
    });
    if (!policy.allowed) {
      return this.createBlockedCommand(ownerUserId, capability, "queue", input, policy.reason);
    }

    const device = this.pickDevice(ownerUserId, "playback.queue", input.deviceId);
    if (!device) {
      return this.createBlockedCommand(ownerUserId, capability, "queue", input, "no_active_device");
    }

    const command = this.createCommand({
      ownerUserId,
      capability,
      action: "queue",
      status: "queued",
      outcome: "queued",
      trackIds: normalizeTrackIds(input.trackIds),
      deviceId: device.deviceId,
      sessionId: input.sessionId,
      requiresConfirmation: false,
      initiator: input.initiator ?? "external_agent",
      agentOriginated: input.agentOriginated ?? true,
    });
    this.publishCommand(command);
    return command;
  }

  requestPlay(ownerUserId: string, input: CommandRequestInput) {
    const capability = this.resolveCapability(ownerUserId, input.capabilityId);
    const policy = this.evaluatePolicy({
      ownerUserId,
      capability,
      scope: "playback.play",
      source: input.source ?? "resonate_catalog",
    });
    if (!policy.allowed) {
      return this.createBlockedCommand(ownerUserId, capability, "play", input, policy.reason);
    }

    const device = this.pickDevice(ownerUserId, "playback.play", input.deviceId);
    if (!device) {
      return this.createBlockedCommand(ownerUserId, capability, "play", input, "no_active_device");
    }

    const requiresConfirmation = capability.confirmationMode !== "remote_control_when_active";
    const command = this.createCommand({
      ownerUserId,
      capability,
      action: "play",
      status: requiresConfirmation ? "pending_confirmation" : "pending",
      outcome: requiresConfirmation ? "confirmation_required" : "queued",
      trackIds: normalizeTrackIds(input.trackIds),
      deviceId: device.deviceId,
      sessionId: input.sessionId,
      requiresConfirmation,
      initiator: input.initiator ?? "external_agent",
      agentOriginated: input.agentOriginated ?? true,
    });
    this.publishCommand(command);
    return command;
  }

  requestControl(ownerUserId: string, input: CommandRequestInput & { action?: PlaybackCommandAction }) {
    const action = input.action ?? "pause";
    if (!["pause", "resume", "skip", "seek", "stop"].includes(action)) {
      throw new BadRequestException("control action must be one of: pause, resume, skip, seek, stop");
    }
    const capability = this.resolveCapability(ownerUserId, input.capabilityId);
    const policy = this.evaluatePolicy({
      ownerUserId,
      capability,
      scope: "playback.control",
      source: input.source ?? "resonate_catalog",
    });
    if (!policy.allowed) {
      return this.createBlockedCommand(ownerUserId, capability, action, input, policy.reason);
    }

    const device = this.pickDevice(ownerUserId, "playback.control", input.deviceId);
    if (!device) {
      return this.createBlockedCommand(ownerUserId, capability, action, input, "no_active_device");
    }

    const command = this.createCommand({
      ownerUserId,
      capability,
      action,
      status: "queued",
      outcome: "queued",
      trackIds: normalizeTrackIds(input.trackIds, { allowEmpty: true }),
      deviceId: device.deviceId,
      sessionId: input.sessionId,
      requiresConfirmation: false,
      initiator: input.initiator ?? "external_agent",
      agentOriginated: input.agentOriginated ?? true,
    });
    this.publishCommand(command);
    return command;
  }

  confirmCommand(ownerUserId: string, input: {
    commandId: string;
    deviceId?: string;
    outcome: PlaybackIntentOutcome;
    status?: PlaybackCommandStatus;
    currentTrackId?: string;
    reason?: string;
  }) {
    const command = this.commands.get(input.commandId);
    if (!command || command.ownerUserId !== ownerUserId) {
      return { outcome: "unavailable" as const, status: "unavailable" as const, reason: "command_not_found" };
    }
    if (input.deviceId && command.deviceId && input.deviceId !== command.deviceId) {
      return { outcome: "blocked_by_policy" as const, status: "blocked" as const, reason: "device_mismatch" };
    }
    const status = input.status ?? statusForOutcome(input.outcome);
    const updated: PlaybackIntentCommand = {
      ...command,
      outcome: input.outcome,
      status,
      confirmedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      reason: input.reason,
    };
    this.commands.set(command.commandId, updated);
    if (input.currentTrackId && command.deviceId) {
      const device = this.devices.get(command.deviceId);
      if (device) {
        this.devices.set(command.deviceId, {
          ...device,
          currentTrackId: input.currentTrackId,
          state: input.outcome === "playing" ? "playing" : device.state,
          lastSeenAt: new Date().toISOString(),
        });
      }
    }
    this.publish("playback.agent_command_confirmed", {
      ownerUserId,
      commandId: updated.commandId,
      outcome: updated.outcome,
      status: updated.status,
      agentOriginated: updated.agentOriginated,
    });
    return updated;
  }

  status(ownerUserId: string, commandId?: string) {
    if (commandId) {
      const command = this.commands.get(commandId);
      if (!command || command.ownerUserId !== ownerUserId) {
        return { outcome: "unavailable" as const, reason: "command_not_found" };
      }
      return command;
    }

    const commands = Array.from(this.commands.values())
      .filter((command) => command.ownerUserId === ownerUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 20);
    return {
      ownerUserId,
      activeDevices: this.activeDevicesForOwner(ownerUserId),
      commands,
    };
  }

  private resolveCapability(ownerUserId: string, capabilityId?: string) {
    if (!capabilityId) {
      return this.defaultOwnerCapability(ownerUserId);
    }
    const capability = this.capabilities.get(capabilityId);
    if (!capability || capability.ownerUserId !== ownerUserId) {
      return {
        ...this.defaultOwnerCapability(ownerUserId),
        id: capabilityId,
        scopes: [],
        revokedAt: new Date().toISOString(),
      };
    }
    return capability;
  }

  private defaultOwnerCapability(ownerUserId: string): PlaybackCapability {
    const id = `owner_default:${ownerUserId}`;
    const existing = this.capabilities.get(id);
    if (existing) {
      return existing;
    }
    const capability = this.createCapability(ownerUserId, {
      id,
      scopes: ALL_PLAYBACK_SCOPES,
      allowedSources: ["resonate_catalog", "preview"],
      confirmationMode: "queue_with_confirmation",
      rateLimitPerMinute: DEFAULT_RATE_LIMIT_PER_MINUTE,
    });
    return capability;
  }

  private evaluatePolicy(input: {
    ownerUserId: string;
    capability: PlaybackCapability;
    scope: PlaybackCapabilityScope;
    source: PlaybackSource;
  }) {
    if (input.capability.revokedAt) {
      return { allowed: false, reason: "capability_revoked" };
    }
    if (input.capability.expiresAt && new Date(input.capability.expiresAt).getTime() <= Date.now()) {
      return { allowed: false, reason: "capability_expired" };
    }
    if (!input.capability.scopes.includes(input.scope)) {
      return { allowed: false, reason: "scope_not_granted" };
    }
    if (!input.capability.allowedSources.includes(input.source)) {
      return { allowed: false, reason: "source_not_granted" };
    }
    if (!this.rateLimitAllows(input.capability)) {
      return { allowed: false, reason: "rate_limited" };
    }
    return { allowed: true };
  }

  private rateLimitAllows(capability: PlaybackCapability) {
    const now = Date.now();
    const windowStart = now - 60_000;
    const recent = (this.requestTimestamps.get(capability.id) ?? []).filter((entry) => entry >= windowStart);
    if (recent.length >= capability.rateLimitPerMinute) {
      this.requestTimestamps.set(capability.id, recent);
      return false;
    }
    recent.push(now);
    this.requestTimestamps.set(capability.id, recent);
    return true;
  }

  private pickDevice(ownerUserId: string, scope: PlaybackCapabilityScope, deviceId?: string) {
    const devices = this.activeDevicesForOwner(ownerUserId).filter((device) => device.supports.includes(scope));
    if (deviceId) {
      return devices.find((device) => device.deviceId === deviceId);
    }
    return devices[0];
  }

  private activeDevicesForOwner(ownerUserId: string) {
    const staleBefore = Date.now() - DEVICE_TTL_MS;
    return Array.from(this.devices.values()).filter((device) => {
      return device.ownerUserId === ownerUserId && device.active && new Date(device.lastSeenAt).getTime() >= staleBefore;
    });
  }

  private createBlockedCommand(
    ownerUserId: string,
    capability: PlaybackCapability,
    action: PlaybackCommandAction,
    input: CommandRequestInput,
    reason?: string,
  ) {
    const outcome: PlaybackIntentOutcome = reason === "no_active_device" ? "no_active_device" : "blocked_by_policy";
    const command = this.createCommand({
      ownerUserId,
      capability,
      action,
      status: outcome === "no_active_device" ? "unavailable" : "blocked",
      outcome,
      trackIds: normalizeTrackIds(input.trackIds, { allowEmpty: true }),
      sessionId: input.sessionId,
      requiresConfirmation: false,
      initiator: input.initiator ?? "external_agent",
      agentOriginated: input.agentOriginated ?? true,
      reason,
    });
    this.publishCommand(command);
    return command;
  }

  private createCommand(input: {
    ownerUserId: string;
    capability: PlaybackCapability;
    action: PlaybackCommandAction;
    status: PlaybackCommandStatus;
    outcome: PlaybackIntentOutcome;
    trackIds: string[];
    deviceId?: string;
    sessionId?: string;
    requiresConfirmation: boolean;
    initiator: "listener" | "external_agent" | "ai_dj";
    agentOriginated: boolean;
    reason?: string;
  }) {
    const now = new Date().toISOString();
    const command: PlaybackIntentCommand = {
      commandId: `playback_cmd_${randomUUID()}`,
      ownerUserId: input.ownerUserId,
      action: input.action,
      status: input.status,
      outcome: input.outcome,
      trackIds: input.trackIds,
      deviceId: input.deviceId,
      sessionId: input.sessionId,
      capabilityId: input.capability.id,
      requiresConfirmation: input.requiresConfirmation,
      initiator: input.initiator,
      agentOriginated: input.agentOriginated,
      createdAt: now,
      updatedAt: now,
      reason: input.reason,
    };
    this.commands.set(command.commandId, command);
    return command;
  }

  private blockedResponse(ownerUserId: string, capability: PlaybackCapability, reason?: string) {
    this.publish("playback.agent_intent_blocked", {
      ownerUserId,
      capabilityId: capability.id,
      reason,
    });
    return {
      ownerUserId,
      capabilityId: capability.id,
      outcome: "blocked_by_policy" as const,
      policy: policySummary(capability, reason),
      candidates: [],
      nextAllowedCommands: [],
      redaction: {
        privateLibrary: "redacted",
        privateTaste: "redacted",
        wallet: "redacted",
        ownership: "redacted",
      },
    };
  }

  private publishCommand(command: PlaybackIntentCommand) {
    this.publish(
      command.outcome === "blocked_by_policy" || command.outcome === "no_active_device"
        ? "playback.agent_intent_blocked"
        : "playback.agent_queue_updated",
      {
        ownerUserId: command.ownerUserId,
        commandId: command.commandId,
        action: command.action,
        outcome: command.outcome,
        status: command.status,
        agentOriginated: command.agentOriginated,
        initiator: command.initiator,
        trackIds: command.trackIds,
        reason: command.reason,
      },
    );
  }

  private publish(eventName: string, payload: Record<string, unknown>) {
    this.eventBus?.publish({
      eventName,
      eventVersion: 1,
      occurredAt: new Date().toISOString(),
      ...payload,
    } as any);
  }

  private catalogResolverOrDefault() {
    return this.catalogResolver ?? new PrismaPlaybackIntentCatalogResolver();
  }
}

type CommandRequestInput = {
  trackIds?: string[];
  deviceId?: string;
  sessionId?: string;
  capabilityId?: string;
  source?: PlaybackSource;
  initiator?: "listener" | "external_agent" | "ai_dj";
  agentOriginated?: boolean;
};

function normalizeScopes(
  value: PlaybackCapabilityScope[] | undefined,
  fallback: PlaybackCapabilityScope[],
): PlaybackCapabilityScope[] {
  const allowed = new Set(ALL_PLAYBACK_SCOPES);
  const scopes = (value ?? fallback).filter((entry): entry is PlaybackCapabilityScope => allowed.has(entry));
  return Array.from(new Set(scopes));
}

function normalizeSources(value?: PlaybackSource[]): PlaybackSource[] {
  const allowed = new Set<PlaybackSource>(["resonate_catalog", "library", "purchased", "preview"]);
  const sources = (value ?? ["resonate_catalog", "preview"]).filter((entry): entry is PlaybackSource => allowed.has(entry));
  return Array.from(new Set(sources));
}

function normalizeConfirmationMode(value?: PlaybackConfirmationMode): PlaybackConfirmationMode {
  if (value === "propose_only" || value === "remote_control_when_active" || value === "queue_with_confirmation") {
    return value;
  }
  return "queue_with_confirmation";
}

function normalizeRateLimit(value?: number) {
  if (!Number.isFinite(value) || value === undefined) {
    return DEFAULT_RATE_LIMIT_PER_MINUTE;
  }
  return Math.min(Math.max(Math.trunc(value), 1), 120);
}

function normalizeConstraints(input?: PlaybackIntentConstraints) {
  return {
    maxTracks: Math.min(Math.max(Number(input?.maxTracks ?? 5), 1), 10),
    explicit: input?.explicit ?? false,
    source: input?.source ?? "resonate_catalog",
    genres: sanitizeStringArray(input?.genres, 8),
    mood: input?.mood?.trim().slice(0, 80) || undefined,
  };
}

function sanitizeQuery(value?: string) {
  return value?.trim().slice(0, 160) || undefined;
}

function sanitizeStringArray(value: unknown, limit: number) {
  if (!Array.isArray(value)) {
    return [];
  }
  return Array.from(
    new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim().slice(0, 80))
        .filter(Boolean),
    ),
  ).slice(0, limit);
}

function normalizeTrackIds(value: string[] | undefined, options?: { allowEmpty?: boolean }) {
  const trackIds = sanitizeStringArray(value, 50);
  if (!options?.allowEmpty && trackIds.length === 0) {
    throw new BadRequestException("trackIds must include at least one track id");
  }
  return trackIds;
}

function policySummary(capability: PlaybackCapability, reason?: string) {
  return {
    capabilityId: capability.id,
    scopes: capability.scopes,
    allowedSources: capability.allowedSources,
    confirmationMode: capability.confirmationMode,
    paymentOrLicensingAllowed: false,
    requiresActiveDevice: true,
    reason,
  };
}

function statusForOutcome(outcome: PlaybackIntentOutcome): PlaybackCommandStatus {
  if (outcome === "playing") return "playing";
  if (outcome === "queued") return "queued";
  if (outcome === "confirmation_required") return "pending_confirmation";
  if (outcome === "blocked_by_policy") return "blocked";
  return "unavailable";
}

function buildCandidateReasons(input: { query?: string; genres?: string[]; mood?: string }) {
  return [
    input.query ? "Matches playback intent query" : "Recent catalog candidate",
    ...(input.genres?.length ? [`Genre preference: ${input.genres.slice(0, 2).join(", ")}`] : []),
    ...(input.mood ? [`Mood preference: ${input.mood}`] : []),
  ].slice(0, 3);
}
