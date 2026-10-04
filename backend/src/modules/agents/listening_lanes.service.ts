import { createHash } from "crypto";
import { readTasteHistory } from "./agent_learning.service";
import { computeListeningLanes, ListeningLane } from "./listening_lanes";
import { readTasteMemoryPolicy, TasteMemoryPolicy } from "../recommendations/taste_memory.service";

export type ListeningLaneSummary = ListeningLane & { hidden: boolean };
const CACHE_LIMIT = 128;
const CACHE_EPOCH_MS = 60 * 60 * 1000;
// One derived result per user. No raw history/session identifiers are retained.
const cache = new Map<string, { version: string; lanes: ListeningLaneSummary[] }>();

/** Cards include hidden lanes so listeners can restore them. */
export async function getListeningLaneSummary(
  userId: string,
  options: { policy?: TasteMemoryPolicy; now?: Date } = {},
): Promise<ListeningLaneSummary[]> {
  const policy = options.policy ?? await readTasteMemoryPolicy(userId);
  const now = options.now ?? new Date();
  const { inputs } = await readTasteHistory(userId, { policy, now });
  const serializeControls = (controls: TasteMemoryPolicy["hidden"]) => [...controls.entries()]
    .map(([type, values]) => [type, [...values].sort()])
    .sort((a, b) => String(a[0]).localeCompare(String(b[0])));
  // A profile version covers catalog/session changes as well as history and
  // policy edits. Hourly epochs bound staleness as evidence decays in silence.
  const version = createHash("sha256").update(JSON.stringify({
    algorithm: "listening-lanes/v1",
    epoch: Math.floor(now.getTime() / CACHE_EPOCH_MS),
    inputs,
    resetAt: policy.resetAt,
    hidden: serializeControls(policy.hidden),
    downranked: serializeControls(policy.downranked),
    boosted: serializeControls(policy.boosted),
  })).digest("hex");
  const hit = cache.get(userId);
  if (hit?.version === version) {
    cache.delete(userId);
    cache.set(userId, hit);
    return structuredClone(hit.lanes);
  }
  const lanes = computeListeningLanes(inputs, now, policy).map((lane) => ({
    ...lane,
    hidden: policy.hidden.get("lane")?.has(lane.id.toLowerCase()) ?? false,
  }));
  cache.delete(userId);
  cache.set(userId, { version, lanes });
  if (cache.size > CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  return structuredClone(lanes);
}

/** Mix consumers fall back to the single profile when this returns no lanes. */
export async function resolveListeningLanes(
  userId: string,
  options: { policy?: TasteMemoryPolicy; now?: Date } = {},
): Promise<ListeningLane[]> {
  return (await getListeningLaneSummary(userId, options))
    .filter((lane) => !lane.hidden)
    .map(({ hidden: _hidden, ...lane }) => lane);
}
