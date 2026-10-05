"use client";

import { useEffect, useState } from "react";
import {
  getTasteMemory,
  removeTasteSignalControl,
  resetTasteMemory,
  updateTasteMemorySettings,
  upsertTasteSignalControl,
  type ManualTasteSignalAction,
  type ProposedTasteEdit,
  type TasteDrift,
  type ListeningLane,
  type ListeningLaneContextKey,
  type TasteMemoryContextSummary,
  type TasteMemoryResponse,
  type TasteMemorySettings,
  type TasteSignalControl,
} from "../../lib/api";
import { recordProductAnalytics } from "../../lib/productAnalytics";
import { Button } from "../ui/Button";
import { ConfirmDialog } from "../ui/ConfirmDialog";
import TasteDriftHint from "./TasteDriftHint";
import TasteEditSection from "./TasteEditSection";
import { controlLabel, controlRemoveLabel, driftProposal, isDeclaredControl } from "./tasteEdits";

type ToastFn = (toast: { type: "success" | "error" | "info" | "warning"; title: string; message: string }) => void;

type Props = {
  token: string | null | undefined;
  addToast: ToastFn;
};

const SIGNAL_TYPES: Array<"genre" | "mood" | "artist" | "scene" | "intent"> = [
  "genre",
  "mood",
  "artist",
  "scene",
  "intent",
];

type TasteMemorySummaryData = TasteMemoryResponse["summary"];
type SummaryItem = { label: string; values: string[]; separator?: string };

const ENERGY_BAND_LABELS: Record<string, string> = { low: "Low", medium: "Medium", high: "High" };
const TEMPO_BAND_LABELS: Record<string, string> = { slow: "Slow", mid: "Medium", medium: "Medium", fast: "Fast" };
const LOCAL_HOUR_LABELS: Record<TasteMemoryContextSummary["localHourBucket"], string> = {
  night: "Nights",
  morning: "Mornings",
  afternoon: "Afternoons",
  evening: "Evenings",
};
const MAX_CONTEXT_ROWS = 8;
const MAX_CONTEXT_VALUES = 5;
const LANE_CONTEXT_LABELS: Record<ListeningLaneContextKey, string> = {
  "night:weekday": "Weekday nights",
  "night:weekend": "Weekend nights",
  "morning:weekday": "Weekday mornings",
  "morning:weekend": "Weekend mornings",
  "afternoon:weekday": "Weekday afternoons",
  "afternoon:weekend": "Weekend afternoons",
  "evening:weekday": "Weekday evenings",
  "evening:weekend": "Weekend evenings",
};
const LANE_ENERGY_LABELS: Record<NonNullable<ListeningLane["energyBand"]>, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
};

function bandLabel(value: string, labels: Record<string, string>) {
  return labels[value.trim().toLowerCase()] ?? value;
}

/** Older servers omit `tasteDrift`; treat that the same as no drift. */
export function tasteDriftOf(summary: TasteMemorySummaryData | null | undefined): TasteDrift | null {
  return summary?.tasteDrift ?? null;
}

export function buildTasteMemorySummaryItems(summary: TasteMemorySummaryData | null | undefined): SummaryItem[] {
  if (!summary) return [];
  const items: SummaryItem[] = [
    { label: "Genres", values: summary.favoredGenres },
    { label: "Moods", values: summary.favoredMoods },
    { label: "Artists", values: summary.favoredArtists },
    { label: "Energy", values: (summary.favoredEnergyBands ?? []).map((value) => bandLabel(value, ENERGY_BAND_LABELS)) },
    { label: "Tempo", values: (summary.favoredTempoBands ?? []).map((value) => bandLabel(value, TEMPO_BAND_LABELS)) },
    { label: "Recent intents", values: summary.recentIntents },
    { label: "Novelty", values: [summary.noveltyPattern] },
    { label: "Commerce", values: [summary.commercePreference] },
  ];

  for (const context of (summary.contexts ?? []).slice(0, MAX_CONTEXT_ROWS)) {
    const values = [
      context.favoredGenres.length
        ? `Genres: ${context.favoredGenres.slice(0, MAX_CONTEXT_VALUES).join(", ")}`
        : "",
      context.favoredMoods.length
        ? `Moods: ${context.favoredMoods.slice(0, MAX_CONTEXT_VALUES).join(", ")}`
        : "",
    ].filter(Boolean);
    items.push({
      label: `${LOCAL_HOUR_LABELS[context.localHourBucket]} · ${context.weekdayKind === "weekday" ? "weekdays" : "weekends"}`,
      values,
      separator: " · ",
    });
  }

  return items;
}

export function clearTasteMemorySummary(summary: TasteMemorySummaryData): TasteMemorySummaryData {
  return {
    ...summary,
    favoredGenres: [],
    favoredMoods: [],
    favoredArtists: [],
    favoredEnergyBands: [],
    favoredTempoBands: [],
    contexts: [],
    listeningLanes: [],
    tasteDrift: null,
    recentIntents: [],
    noveltyPattern: "Balanced discovery",
    commercePreference: "Listening first",
  };
}

export async function resetTasteMemoryState(args: {
  token: string;
  memory: TasteMemoryResponse;
  setMemory: (memory: TasteMemoryResponse) => void;
}): Promise<TasteMemoryResponse> {
  const settings = await resetTasteMemory(args.token);
  const updatedMemory = {
    ...args.memory,
    settings,
    controls: args.memory.controls.filter((control) => control.signalType !== "lane"),
    summary: clearTasteMemorySummary(args.memory.summary),
  };
  args.setMemory(updatedMemory);
  return updatedMemory;
}

export function TasteMemorySummary({ summary }: { summary: TasteMemorySummaryData | null | undefined }) {
  const items = buildTasteMemorySummaryItems(summary);
  return (
    <div className="taste-memory-grid">
      {items.map((item) => (
        <div className="taste-memory-stat" key={item.label}>
          <span>{item.label}</span>
          <strong>{item.values.length ? item.values.join(item.separator ?? ", ") : "Not enough signal yet"}</strong>
        </div>
      ))}
    </div>
  );
}

export function buildListeningLaneContextLabels(lane: ListeningLane): string[] {
  return Object.entries(lane.contexts)
    .filter((entry): entry is [string, number] => {
      const [key, weight] = entry;
      return key in LANE_CONTEXT_LABELS && weight !== undefined && Number.isFinite(weight) && weight > 0;
    })
    .sort((a, b) => b[1] - a[1])
    .map(([key]) => LANE_CONTEXT_LABELS[key as ListeningLaneContextKey]);
}

export function ListeningLaneSection({
  lanes,
  controls,
  saving,
  onHide,
  onRestore,
}: {
  lanes: ListeningLane[];
  controls: TasteSignalControl[];
  saving: boolean;
  onHide: (lane: ListeningLane) => void;
  onRestore: (lane: ListeningLane) => void;
}) {
  return (
    <section className="taste-memory-lanes" data-testid="listening-lanes">
      <h4>Your listening lanes</h4>
      {lanes.length ? (
        <>
          <p>Hide a lane to keep it out of My Mix in the AI DJ. Restore it whenever you want it back.</p>
          <div className="taste-memory-lane-grid">
            {lanes.map((lane) => {
              const contextLabels = buildListeningLaneContextLabels(lane);
              const laneControl = controls.find((control) => control.signalType === "lane" && control.value === lane.id);
              return (
                <article className="taste-memory-lane" data-testid="listening-lane-card" key={lane.id}>
                  <strong>{lane.label}</strong>
                  <p>{contextLabels.length ? contextLabels.join(" · ") : "More patterns will appear after repeated sessions."}</p>
                  {lane.energyBand ? <p>Typical energy: {LANE_ENERGY_LABELS[lane.energyBand]}</p> : null}
                  {lane.hidden ? (
                    laneControl ? (
                      <Button variant="ghost" onClick={() => onRestore(lane)} disabled={saving}>
                        Restore to mixes
                      </Button>
                    ) : (
                      <span>Hidden listening lane</span>
                    )
                  ) : (
                    <Button variant="ghost" onClick={() => onHide(lane)} disabled={saving}>
                      Hide from mixes
                    </Button>
                  )}
                </article>
              );
            })}
          </div>
        </>
      ) : (
        <p>No lanes yet. Repeated listening sessions are needed before listening lanes and My Mix appear.</p>
      )}
    </section>
  );
}

export function filterGenericTasteControls(controls: TasteSignalControl[], lanes: ListeningLane[]) {
  const laneIds = new Set(lanes.map((lane) => lane.id));
  return controls.filter((control) => control.signalType !== "lane" || !laneIds.has(control.value));
}

export function TasteSignalControlList({
  controls,
  savingKey,
  onRestore,
}: {
  controls: TasteSignalControl[];
  savingKey: string | null;
  onRestore: (control: TasteSignalControl) => void;
}) {
  return controls.length ? (
    <ul className="taste-memory-signal-list">
      {controls.map((control) => {
        const isLane = control.signalType === "lane";
        return (
          <li key={control.id}>
            <div>
              <strong>
                {isLane
                  ? "Hidden listening lane"
                  : control.signalType === "note" ? `\u201c${control.value}\u201d` : control.value}
              </strong>
              {isLane ? null : <span>{controlLabel(control)}</span>}
              {isDeclaredControl(control) ? (
                <span className="taste-memory-declared">
                  Declared by you &middot; stays until you remove it
                </span>
              ) : null}
            </div>
            <Button
              variant="ghost"
              onClick={() => onRestore(control)}
              disabled={savingKey === control.id}
              aria-label={isLane
                ? "Restore hidden listening lane"
                : `${controlRemoveLabel(control)}: ${control.value}`}
            >
              {controlRemoveLabel(control)}
            </Button>
          </li>
        );
      })}
    </ul>
  ) : (
    <div className="taste-memory-empty">No taste controls yet.</div>
  );
}

export default function TasteMemorySettingsPanel({ token, addToast }: Props) {
  const [memory, setMemory] = useState<TasteMemoryResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [newSignalType, setNewSignalType] = useState<(typeof SIGNAL_TYPES)[number]>("genre");
  const [newSignalValue, setNewSignalValue] = useState("");
  const [newSignalAction, setNewSignalAction] = useState<ManualTasteSignalAction>("hidden");
  const [confirmReset, setConfirmReset] = useState(false);
  const [proposal, setProposal] = useState<{ key: string; items: ProposedTasteEdit[] } | null>(null);

  const load = async () => {
    if (!token) return;
    setLoading(true);
    try {
      setMemory(await getTasteMemory(token));
    } catch {
      addToast({
        type: "error",
        title: "Taste memory unavailable",
        message: "Could not load your taste memory controls.",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- token changes are the reload boundary.
  }, [token]);

  const listeningLanes = memory?.summary.listeningLanes ?? [];
  const drift = tasteDriftOf(memory?.summary);
  const genericControls = filterGenericTasteControls(memory?.controls ?? [], listeningLanes);

  const updateSetting = async <K extends keyof Omit<TasteMemorySettings, "resetAt">>(
    key: K,
    value: TasteMemorySettings[K],
  ) => {
    if (!token || !memory) return;
    setSavingKey(key);
    const previous = memory;
    setMemory({ ...memory, settings: { ...memory.settings, [key]: value } });
    try {
      const settings = await updateTasteMemorySettings(token, { [key]: value });
      setMemory({ ...previous, settings });
      void recordProductAnalytics(token, "taste_memory.settings_updated", {
        source: "settings",
        subjectType: "taste_memory",
        payload: { setting: key, enabled: typeof value === "boolean" ? value : undefined },
      });
    } catch {
      setMemory(previous);
      addToast({ type: "error", title: "Setting not saved", message: "Please try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const addControl = async () => {
    if (!token || !newSignalValue.trim()) return;
    setSavingKey("signal");
    try {
      const control = await upsertTasteSignalControl(token, {
        signalType: newSignalType,
        value: newSignalValue,
        action: newSignalAction,
        source: "settings",
      });
      await load();
      setNewSignalValue("");
      void recordProductAnalytics(token, "taste_memory.signal_hidden", {
        source: "settings",
        subjectType: "taste_signal",
        payload: { signalType: control.signalType, action: control.action },
      });
      addToast({ type: "success", title: "Taste signal updated", message: "Recommendations will respect this." });
    } catch {
      addToast({ type: "error", title: "Signal not saved", message: "Check the value and try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const hideLane = async (lane: ListeningLane) => {
    if (!token) return;
    setSavingKey("lane");
    try {
      await upsertTasteSignalControl(token, {
        signalType: "lane",
        value: lane.id,
        action: "hidden",
        source: "settings",
      });
      await load();
      void recordProductAnalytics(token, "taste_memory.signal_hidden", {
        source: "settings",
        subjectType: "taste_signal",
        payload: { signalType: "lane", action: "hidden" },
      });
    } catch {
      addToast({ type: "error", title: "Lane not hidden", message: "Please try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const restoreControl = async (control: TasteSignalControl) => {
    if (!token) return;
    const controlSavingKey = control.signalType === "lane" ? "lane" : control.id;
    setSavingKey(controlSavingKey);
    try {
      await removeTasteSignalControl(token, control.id);
      await load();
      void recordProductAnalytics(token, "taste_memory.signal_restored", {
        source: "settings",
        subjectType: "taste_signal",
        payload: { signalType: control.signalType, action: control.action },
      });
    } catch {
      addToast({ type: "error", title: "Signal not restored", message: "Please try again." });
    } finally {
      setSavingKey(null);
    }
  };

  const restoreLane = async (lane: ListeningLane) => {
    if (!token || !memory) return;
    const laneControl = memory.controls.find((control) => control.signalType === "lane" && control.value === lane.id);
    if (!laneControl) return;
    await restoreControl(laneControl);
  };

  const proposeMore = (signalType: "genre" | "mood", value: string) => {
    // Pre-fills the preview only; the listener still has to press Apply.
    setProposal({ key: `${signalType}:${value}:${Date.now()}`, items: [driftProposal(signalType, value)] });
  };

  const removeDriftBoost = async (controlId: string) => {
    const control = memory?.controls.find((candidate) => candidate.id === controlId);
    if (control) await restoreControl(control);
  };

  const confirmResetMemory = async () => {
    if (!token || !memory) return;
    setSavingKey("reset");
    try {
      await resetTasteMemoryState({ token, memory, setMemory });
      void recordProductAnalytics(token, "taste_memory.reset", {
        source: "settings",
        subjectType: "taste_memory",
        payload: { reset: true },
      });
      addToast({ type: "success", title: "Taste memory reset", message: "New signals will build from here." });
    } catch {
      addToast({ type: "error", title: "Reset failed", message: "Please try again." });
    } finally {
      setSavingKey(null);
      setConfirmReset(false);
    }
  };

  return (
    <div className="settings-section">
      <div className="settings-section-header">
        <div>
          <h3 className="settings-section-title">Taste Memory</h3>
          <p className="home-subtitle">
            Inspect and govern the safe taste signals used for recommendations and AI DJ behavior.
          </p>
        </div>
        <Button variant="ghost" onClick={load} disabled={loading || !token}>
          {loading ? "Refreshing..." : "Refresh"}
        </Button>
      </div>

      <TasteMemorySummary summary={memory?.summary} />

      {memory ? (
        <ListeningLaneSection
          lanes={listeningLanes}
          controls={memory.controls}
          saving={savingKey === "lane"}
          onHide={hideLane}
          onRestore={restoreLane}
        />
      ) : null}

      <div className="taste-memory-controls">
        <TasteToggle
          label="Taste-based social matching"
          description="Allow future community matching to use governed taste summaries."
          checked={memory?.settings.socialMatchingEnabled ?? false}
          disabled={!memory || savingKey === "socialMatchingEnabled"}
          onChange={(checked) => updateSetting("socialMatchingEnabled", checked)}
        />
        <TasteToggle
          label="City and scene discovery"
          description="Allow recommendations to lean on city or scene discovery when those features mature."
          checked={memory?.settings.citySceneDiscoveryEnabled ?? false}
          disabled={!memory || savingKey === "citySceneDiscoveryEnabled"}
          onChange={(checked) => updateSetting("citySceneDiscoveryEnabled", checked)}
        />
        <TasteToggle
          label="AI DJ playback trains taste"
          description="Let your playback and library activity shape taste when analytics consent is enabled."
          checked={memory?.settings.agentPlaybackTrainingEnabled ?? true}
          disabled={!memory || savingKey === "agentPlaybackTrainingEnabled"}
          onChange={(checked) => updateSetting("agentPlaybackTrainingEnabled", checked)}
        />
      </div>

      <div className="taste-memory-row">
        <label className="taste-memory-field">
          <span>Recommendation explanations</span>
          <select
            value={memory?.settings.recommendationExplanationPreference ?? "balanced"}
            disabled={!memory || savingKey === "recommendationExplanationPreference"}
            onChange={(event) =>
              updateSetting("recommendationExplanationPreference", event.target.value as TasteMemorySettings["recommendationExplanationPreference"])
            }
          >
            <option value="compact">Compact</option>
            <option value="balanced">Balanced</option>
            <option value="detailed">Detailed</option>
          </select>
        </label>
      </div>

      {drift ? (
        <TasteDriftHint
          drift={drift}
          controls={memory?.controls ?? []}
          onProposeMore={proposeMore}
          onRemoveBoost={removeDriftBoost}
          busy={savingKey !== null}
        />
      ) : null}

      <TasteEditSection token={token} addToast={addToast} onApplied={setMemory} proposal={proposal} />

      <div className="taste-memory-editor">
        <div className="taste-memory-editor-inputs">
          <select value={newSignalType} onChange={(event) => setNewSignalType(event.target.value as typeof newSignalType)}>
            {SIGNAL_TYPES.map((type) => (
              <option key={type} value={type}>{type}</option>
            ))}
          </select>
          <select value={newSignalAction} onChange={(event) => setNewSignalAction(event.target.value as typeof newSignalAction)}>
            <option value="hidden">Hide</option>
            <option value="downranked">Downrank</option>
          </select>
          <input
            value={newSignalValue}
            onChange={(event) => setNewSignalValue(event.target.value)}
            placeholder="Signal value, e.g. Techno"
          />
          <Button onClick={addControl} disabled={!newSignalValue.trim() || savingKey === "signal"}>
            Add
          </Button>
        </div>

        <TasteSignalControlList controls={genericControls} savingKey={savingKey} onRestore={restoreControl} />
      </div>

      <div className="taste-memory-danger">
        <div>
          <strong>Reset taste memory</strong>
          <p>Keep the audit trail, but stop using older signals for recommendations and AI DJ learning.</p>
        </div>
        <Button variant="ghost" onClick={() => setConfirmReset(true)} disabled={!memory || savingKey === "reset"}>
          Reset
        </Button>
      </div>

      <ConfirmDialog
        isOpen={confirmReset}
        title="Reset taste memory?"
        message="Recommendations and AI DJ learning will ignore older taste signals. New listening choices can train a fresh profile."
        confirmLabel="Reset"
        variant="warning"
        onConfirm={confirmResetMemory}
        onCancel={() => setConfirmReset(false)}
      />
    </div>
  );
}

function TasteToggle({
  label,
  description,
  checked,
  disabled,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="taste-memory-toggle">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span>
        <strong>{label}</strong>
        <small>{description}</small>
      </span>
    </label>
  );
}
