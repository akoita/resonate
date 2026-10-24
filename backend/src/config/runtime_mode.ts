/**
 * Backend runtime mode (#1608).
 *
 * One backend image, one codebase, one `AppModule`. `BACKEND_RUNTIME_MODE`
 * decides which process role it plays:
 *
 *  - `combined` (default): today's behaviour. The process serves HTTP and also
 *    runs every background loop.
 *  - `api`: serves HTTP and starts NO background loop, so an idle instance
 *    costs nothing and can scale to zero.
 *  - `worker`: runs the background loops. It still boots the whole module graph
 *    (the in-process `EventBus` joins each indexer to the subscribers that
 *    persist and fan out its events), but answers only the health route over
 *    HTTP.
 *
 * Every background loop is declared once in {@link BACKGROUND_LOOPS} and asks
 * {@link shouldRunBackgroundLoop} before it starts. This is the only place the
 * variable is read.
 */

export const BACKEND_RUNTIME_MODES = ["combined", "api", "worker"] as const;
export type BackendRuntimeMode = (typeof BACKEND_RUNTIME_MODES)[number];

export const DEFAULT_BACKEND_RUNTIME_MODE: BackendRuntimeMode = "combined";

type WarnSink = (message: string) => void;

const warnedInvalidValues = new Set<string>();

/**
 * Resolves the mode. A missing value is `combined`. An unrecognised value is
 * also `combined` (the behaviour every deployment had before the flag) and is
 * warned about once per distinct value, never thrown: a typo must not take the
 * API down.
 */
export function resolveBackendRuntimeMode(
  env: NodeJS.ProcessEnv = process.env,
  warn: WarnSink = (message) => console.warn(message),
): BackendRuntimeMode {
  const raw = env.BACKEND_RUNTIME_MODE?.trim().toLowerCase();
  if (!raw) return DEFAULT_BACKEND_RUNTIME_MODE;
  if ((BACKEND_RUNTIME_MODES as readonly string[]).includes(raw)) {
    return raw as BackendRuntimeMode;
  }
  if (!warnedInvalidValues.has(raw)) {
    warnedInvalidValues.add(raw);
    warn(
      `[RuntimeMode] Unknown BACKEND_RUNTIME_MODE "${env.BACKEND_RUNTIME_MODE}"; ` +
        `falling back to "${DEFAULT_BACKEND_RUNTIME_MODE}". ` +
        `Valid values: ${BACKEND_RUNTIME_MODES.join(", ")}.`,
    );
  }
  return DEFAULT_BACKEND_RUNTIME_MODE;
}

/** Test seam: forget which invalid values were already warned about. */
export function resetRuntimeModeWarnings(): void {
  warnedInvalidValues.clear();
}

/**
 * Every loop that must not run in an `api` process, keyed for the gate.
 *
 * `kind` documents why it is background work:
 *  - `indexer`: follows the chain and persists what it sees
 *  - `reconciler`: repairs or re-checks persisted state on a schedule/at boot
 *  - `consumer`: pulls work from a queue or subscription
 *  - `refresher`: recomputes a derived read model
 */
export const BACKGROUND_LOOPS = {
  contractIndexer: { kind: "indexer", description: "Marketplace/StemNFT/content-protection contract indexer" },
  showsEscrowIndexer: { kind: "indexer", description: "Shows campaign escrow indexer (distributed lease, #1567)" },
  contractsStartupReconcile: {
    kind: "reconciler",
    description: "Listing, lifecycle and orphan-listing reconcilers and the pending sale-split retry (#2172) at boot",
  },
  stemWatchdog: { kind: "reconciler", description: "Stuck stem-processing sweep" },
  x402RefundWatchdog: { kind: "reconciler", description: "Stale x402 refund_due sweep" },
  agentReputationScheduler: { kind: "reconciler", description: "ERC-8004 reputation attestation sweep" },
  discoveryPopularityRefresh: { kind: "refresher", description: "Local discovery popularity refresh timer" },
  stemResultSubscriber: { kind: "consumer", description: "Pub/Sub stem-results subscription" },
  stemsQueueProcessor: { kind: "consumer", description: "BullMQ `stems` queue processor" },
  generationQueueProcessor: { kind: "consumer", description: "BullMQ `generation` queue processor" },
  remixGenerationQueueProcessor: { kind: "consumer", description: "BullMQ remix generation queue processor" },
  startupSelfHealing: {
    kind: "reconciler",
    description: "Boot-time indexer cursor fast-forward and relative-URI normalisation in main.ts",
  },
} as const;

export type BackgroundLoopId = keyof typeof BACKGROUND_LOOPS;

/** True when this mode starts background loops (`combined` and `worker`). */
export function runsBackgroundLoops(mode: BackendRuntimeMode): boolean {
  return mode !== "api";
}

/** True when this process answers the public HTTP API (`combined` and `api`). */
export function servesPublicApi(mode: BackendRuntimeMode): boolean {
  return mode !== "worker";
}

type LoopLogger = { log(message: string): void };

const loopDecisions = new Map<BackgroundLoopId, boolean>();

/**
 * The single gate. Call it at the point a loop would start; when it returns
 * false the loop must not start. The decision is recorded so a test or an
 * operator probe can see what this process chose.
 */
export function shouldRunBackgroundLoop(
  id: BackgroundLoopId,
  logger?: LoopLogger,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const mode = resolveBackendRuntimeMode(env);
  const run = runsBackgroundLoops(mode);
  loopDecisions.set(id, run);
  if (!run) {
    logger?.log(
      `Background loop "${id}" not started: BACKEND_RUNTIME_MODE=${mode} (a worker process runs it)`,
    );
  }
  return run;
}

/** Providers that only exist in a process that runs background loops. */
export function backgroundLoopProviders<T>(
  id: BackgroundLoopId,
  providers: T[],
  env: NodeJS.ProcessEnv = process.env,
): T[] {
  return shouldRunBackgroundLoop(id, undefined, env) ? providers : [];
}

/** Snapshot of the gate decisions this process has made so far. */
export function backgroundLoopDecisions(): Record<string, boolean> {
  return Object.fromEntries(loopDecisions);
}

/** Test seam. */
export function resetBackgroundLoopDecisions(): void {
  loopDecisions.clear();
}
